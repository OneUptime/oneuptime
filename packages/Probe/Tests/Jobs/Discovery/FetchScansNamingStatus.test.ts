// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * The smallest sweep deadline Config accepts, so the one test here about a
 * wedged sweep drives the REAL Config -> runScan deadline and still finishes
 * in a second. Every other sweep in this file is mocked to settle at once,
 * and scanWithDeadline disarms the timer before naming starts, so none of
 * them is affected by it.
 */
process.env["PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS"] = "1000";
/*
 * Unset, so the reverse-DNS pass is handed no fixed budget and sizes its own —
 * the default every probe runs with. Cleared before any import because
 * Config.ts reads it once at load and a developer's shell may carry one.
 */
delete process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"];
/*
 * Unset for the same reason, so the NetBIOS lookup runs under the resolver's
 * own DEFAULT_NETBIOS_MAX_HOSTS and scanWithDeadline hands the seam no cap.
 * The one test about a RAISED cap sets it around a freshly loaded module
 * graph, because Config.ts reads it once at load.
 */
delete process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"];
// A custom (non-global) probe unless a test says otherwise. Same reason.
delete process.env["REGISTER_PROBE_KEY"];

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import SubnetScanner, {
  DiscoveredHost,
  type NetbiosPassOptions,
  type ReverseDnsPassOptions,
  type SubnetScanConfig,
  type SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import {
  getReverseDnsTotalBudgetInMs,
  ReverseDnsResolution,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  DEFAULT_NETBIOS_MAX_HOSTS,
  DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
  MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
  NetbiosNameResolution,
} from "../../../Utils/Discovery/NetbiosNameResolver";
import {
  DiscoveryNetbiosPolicy,
  runScan,
} from "../../../Jobs/Discovery/FetchScans";
import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
} from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * The naming note, end to end: from what the two post-sweep naming seams
 * report, through runScan, to the statusMessage the probe POSTs.
 *
 * The reverse-DNS pass asks addresses in ascending order and stops at its
 * wall-clock budget or when the resolver proves unusable; the NetBIOS lookup
 * stops at its host cap, its budget, or a failed UDP socket. Either way the
 * TAIL of a big sweep keeps IP-address names, and until the verdict was
 * carried onto the status message the only trace of that was a warning in the
 * probe log. A Review dialog full of bare addresses from 10.20.4.0 upwards
 * looked exactly like a network that publishes no PTR records.
 *
 * buildHostNamingNote and finishStatusMessage are pinned as functions in
 * DiscoveryScanStatusMessage.test.ts. What only a run can show, and what this
 * file pins, is the wiring either side of them — and all of it fails silently:
 *
 *   1. scanWithDeadline has to keep each pass's WHOLE verdict on the result.
 *      Keep only the count (what it used to do) and every message below
 *      degrades to the plain sweep summary, with every test of the builder
 *      still green.
 *   2. The note belongs on the FINAL upload only. A progress upload is taken
 *      before either pass has run, so a note there would describe nothing.
 *   3. A sweep that fails never reaches the passes, so its report must carry
 *      the sweep's failure and nothing about naming.
 *   4. Whatever is appended, the upload fits the 500-character column. The
 *      full note rides along when it fits; when it does not, the COMPACT note
 *      replaces it, and only if even that does not fit are the sweep's own
 *      non-essential sentences clipped — sentence by sentence, so what is left
 *      out is left out whole and the cut is marked once. The headline (and, on
 *      an incomplete ping-only sweep, the caveat read with it) is never the
 *      part cut.
 *   5. What the seams report beyond counts reaches the operator: the
 *      resolver's own failure reason, the budget it ran under (which decides
 *      whether "raise the variable" is advice at all), and an empty thrown
 *      error, which must read as "unknown error" rather than a class name.
 *   6. The note is a SEPARATE sentence from the sweep's own. The SNMP-error
 *      sentence ends with the quoted error rather than a full stop, so without
 *      one inserted the note reads as more of the error text.
 *   7. PROBE_DISCOVERY_NETBIOS_MAX_HOSTS reaches the NetBIOS seam. The cap note
 *      tells the operator to raise it, which is only advice if the value they
 *      set is the one the lookup runs under.
 *
 * The harness is FetchScansLifecycle's: API.fetch is stubbed so nothing leaves
 * the process, and SubnetScanner.scan is spied so no subnet is swept. Both
 * naming seams are replaced with doubles for every test, so no DNS query or
 * UDP datagram is ever sent.
 */

const scanId: ObjectID = ObjectID.generate();

const RESULT_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/result";

// The ingest column's width, and the bound the probe keeps itself inside.
const MAX_STATUS_MESSAGE_LENGTH: number = 500;

/*
 * The caveat an incomplete ping-only sweep leads with, written out once
 * because several tests assert it survives WHOLE ahead of its headline.
 */
const INCOMPLETE_ICMP_SWEEP_CAVEAT: string =
  "This ping sweep stopped early - the probe could not keep sending ICMP echo requests, " +
  "so an unknown part of the range was never checked. " +
  "The hosts reported are the ones confirmed before it stopped.";

function makeScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    cidr: "10.20.0.0/20",
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

// What the server stores for a ping-only scan: see FetchScansIcmpOnly.test.ts.
function makeIcmpOnlyScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return makeScan({
    isSnmpEnabled: false,
    snmpVersion: null,
    snmpCommunityString: null,
    snmpPort: null,
    ...overrides,
  });
}

/*
 * Distinct private addresses, ascending within each third octet. Private on
 * purpose: the NetBIOS resolver only ever targets private IPv4, so a fixture
 * on public space would describe hosts the lookup refuses rather than hosts it
 * ran out of room for.
 */
function hostAddress(index: number): string {
  return `10.20.${Math.floor(index / 250)}.${(index % 250) + 1}`;
}

/*
 * `count` hosts, the first `snmpCount` of them SNMP responders with a sysName
 * and the rest ping-only — the mix a real sweep of an office range returns.
 */
function makeHosts(
  count: number,
  snmpCount: number = 0,
): Array<DiscoveredHost> {
  const hosts: Array<DiscoveredHost> = [];

  for (let index: number = 0; index < count; index++) {
    hosts.push(
      index < snmpCount
        ? {
            ipAddress: hostAddress(index),
            sysName: `core-switch-${index + 1}`,
            sysDescr: "Cisco IOS",
            snmpReachable: true,
            snmpConfigId: "legacy",
          }
        : { ipAddress: hostAddress(index), snmpReachable: false },
    );
  }

  return hosts;
}

function makeSnmpResult(
  hosts: Array<DiscoveredHost>,
  overrides?: Partial<SubnetScanResult>,
): SubnetScanResult {
  return {
    discoveredHosts: hosts,
    scannedHostCount: 4094,
    scannedPorts: [161],
    responderCountByConfigId: {
      legacy: hosts.filter((host: DiscoveredHost) => {
        return host.snmpReachable;
      }).length,
    },
    respondedToPingCount: hosts.length,
    snmpErrorHostCount: 0,
    icmpFilteredFallbackHostCount: 0,
    ...overrides,
  };
}

function makeIcmpOnlyResult(
  hosts: Array<DiscoveredHost>,
  overrides?: Partial<SubnetScanResult>,
): SubnetScanResult {
  return {
    discoveredHosts: hosts,
    scannedHostCount: 4094,
    scannedPorts: [],
    responderCountByConfigId: {},
    respondedToPingCount: hosts.length,
    snmpErrorHostCount: 0,
    icmpFilteredFallbackHostCount: 0,
    isIcmpOnlySweep: true,
    isIcmpSweepIncomplete: false,
    ...overrides,
  };
}

type ReverseDnsVerdict = {
  // Distinct addresses, from the front of the list, that come back named.
  namedCount: number;
  // Distinct addresses a lookup was started for; the rest were never asked.
  lookedUpCount: number;
  isTimeBudgetExhausted?: boolean;
  isReverseDnsAvailable?: boolean;
  // Defaults to what the resolver sizes for this many addresses.
  totalBudgetInMs?: number;
  // The resolver's first infrastructure failure, when it reported one.
  failureReason?: string;
  /*
   * Distinct addresses, straight after the named ones, whose lookup FAILED
   * (OneUptime issue #3916). When set, the double also
   * reports a per-address status for every address it did not name — timeout
   * for these, no-record for the rest it reached, and a skip for the ones it
   * never asked — the way ReverseDnsResolver does. Left unset, the double
   * reports neither, exactly as it did before the codes existed, so every
   * older test here still describes the same hosts.
   */
  failedCount?: number;
};

type ReverseDnsPassCall = {
  ipAddresses: Array<string>;
  options: ReverseDnsPassOptions | undefined;
};

/*
 * Replaces the reverse-DNS seam with a pass that stops where the verdict says,
 * shaped the way ReverseDnsResolver really stops: names only among the
 * addresses it reached, in the order it was handed them, and
 * lookedUpCount + notLookedUpCount equal to the distinct addresses asked.
 * Records every call, so "was the pass asked at all, and with what budget" is
 * checkable.
 */
function mockReverseDnsPass(
  verdict: ReverseDnsVerdict,
): Array<ReverseDnsPassCall> {
  const calls: Array<ReverseDnsPassCall> = [];

  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(
      async (
        ipAddresses: Array<string>,
        options?: ReverseDnsPassOptions,
      ): Promise<ReverseDnsResolution> => {
        calls.push({ ipAddresses: [...ipAddresses], options: options });

        const distinct: Array<string> = Array.from(
          new Set<string>(ipAddresses),
        );
        const lookedUpCount: number = Math.min(
          verdict.lookedUpCount,
          distinct.length,
        );
        const hostnameByIpAddress: Map<string, string> = new Map<
          string,
          string
        >();

        const namedCount: number = Math.min(verdict.namedCount, lookedUpCount);

        distinct
          .slice(0, namedCount)
          .forEach((ipAddress: string, index: number) => {
            hostnameByIpAddress.set(
              ipAddress,
              `host-${index + 1}.corp.example.com`,
            );
          });

        const resolution: ReverseDnsResolution = {
          hostnameByIpAddress: hostnameByIpAddress,
          isReverseDnsAvailable: verdict.isReverseDnsAvailable ?? true,
          isTimeBudgetExhausted: verdict.isTimeBudgetExhausted ?? false,
          lookedUpCount: lookedUpCount,
          notLookedUpCount: distinct.length - lookedUpCount,
          totalBudgetInMs:
            verdict.totalBudgetInMs ??
            getReverseDnsTotalBudgetInMs({ addressCount: distinct.length }),
          failureReason: verdict.failureReason,
        };

        if (verdict.failedCount !== undefined) {
          const failedCount: number = Math.min(
            verdict.failedCount,
            lookedUpCount - namedCount,
          );
          const statusByIpAddress: Map<string, DiscoveredHostReverseDnsStatus> =
            new Map<string, DiscoveredHostReverseDnsStatus>();

          distinct.forEach((ipAddress: string, index: number) => {
            if (index < namedCount) {
              return;
            }

            statusByIpAddress.set(
              ipAddress,
              index < namedCount + failedCount
                ? DiscoveredHostReverseDnsStatus.Timeout
                : index < lookedUpCount
                  ? DiscoveredHostReverseDnsStatus.NoRecord
                  : DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
            );
          });

          resolution.statusByIpAddress = statusByIpAddress;
          resolution.failedAddressCount = failedCount;
        }

        return resolution;
      },
    );

  return calls;
}

type NetbiosVerdict = {
  namedCount: number;
  queriedCount: number;
  isHostCapReached?: boolean;
  isTimeBudgetExhausted?: boolean;
  maxHosts?: number;
  totalBudgetInMs?: number;
  failureReason?: string;
};

type NetbiosPassCall = {
  ipAddresses: Array<string>;
  /*
   * The second argument scanWithDeadline hands SubnetScanner.attachNetbiosNames
   * and that method forwards here — the probe's PROBE_DISCOVERY_NETBIOS_MAX_HOSTS.
   * Recorded because the cap note's advice ("raise it") is only advice if the
   * value the operator sets is the one the lookup runs under.
   */
  options: NetbiosPassOptions | undefined;
};

/*
 * The double the two mockNetbiosPass* helpers install. Written once and
 * installed on a given SubnetScanner, because the raised-cap test below drives
 * a FRESHLY loaded module graph whose SubnetScanner is a different object from
 * this file's, and that copy needs the same lookup-free seam.
 *
 * Shaped the way NetbiosNameResolver really stops: every address handed over
 * is private and so eligible, names only among those queried, and
 * queriedCount + skippedCount equal to the distinct addresses asked.
 */
function installNetbiosDouble(
  scanner: typeof SubnetScanner,
  verdict: NetbiosVerdict,
): Array<NetbiosPassCall> {
  const calls: Array<NetbiosPassCall> = [];

  jest
    .spyOn(scanner, "resolveNetbiosNames")
    .mockImplementation(
      async (
        ipAddresses: Array<string>,
        options?: NetbiosPassOptions | undefined,
      ): Promise<NetbiosNameResolution> => {
        calls.push({ ipAddresses: [...ipAddresses], options: options });

        const distinct: Array<string> = Array.from(
          new Set<string>(ipAddresses),
        );
        const queriedCount: number = Math.min(
          verdict.queriedCount,
          distinct.length,
        );
        const nameByIpAddress: Map<string, string> = new Map<string, string>();

        distinct
          .slice(0, Math.min(verdict.namedCount, queriedCount))
          .forEach((ipAddress: string, index: number) => {
            nameByIpAddress.set(ipAddress, `ws${index + 1}`);
          });

        return {
          nameByIpAddress: nameByIpAddress,
          queriedCount: queriedCount,
          skippedCount: distinct.length - queriedCount,
          isTimeBudgetExhausted: verdict.isTimeBudgetExhausted ?? false,
          isHostCapReached: verdict.isHostCapReached ?? false,
          eligibleCount: distinct.length,
          maxHosts: verdict.maxHosts ?? DEFAULT_NETBIOS_MAX_HOSTS,
          totalBudgetInMs:
            verdict.totalBudgetInMs ?? DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
          failureReason: verdict.failureReason,
        };
      },
    );

  return calls;
}

// The double, on the SubnetScanner this file's runScan reaches.
function mockNetbiosPass(verdict: NetbiosVerdict): Array<NetbiosPassCall> {
  return installNetbiosDouble(SubnetScanner, verdict);
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let scanSpy = jest.spyOn(SubnetScanner, "scan");

/*
 * Reverse DNS and NetBIOS both run at the end of scanWithDeadline, on whatever
 * hosts the MOCKED sweep hands back. Stubbed for the whole file so a test that
 * does not install its own double still never reaches a real resolver or
 * socket; ReverseDnsStubIntegrity.test.ts fails the build if a file that
 * drives this path forgets. Registered before the file's own beforeEach, so a
 * double installed by a test replaces the stub rather than the other way
 * round.
 */
stubReverseDnsAsResolvingNothing();

beforeEach(() => {
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  scanSpy = jest
    .spyOn(SubnetScanner, "scan")
    .mockResolvedValue(makeSnmpResult(makeHosts(1)) as never);

  // Keep the test output readable.
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Every body POSTed to the result endpoint, partial and final, in order.
function resultUploads(): Array<JSONObject> {
  return fetchSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as JSONObject;
    })
    .filter((arg: JSONObject) => {
      return String(arg["url"]) === RESULT_URL;
    })
    .map((arg: JSONObject) => {
      return arg["data"] as JSONObject;
    });
}

/*
 * The one upload that finishes the run. Exactly one, and it has to be the
 * LAST: a finished run's report landing ahead of a partial would let the
 * partial replace its names on the server.
 */
function finalUpload(): JSONObject {
  const uploads: Array<JSONObject> = resultUploads();
  const finals: Array<JSONObject> = uploads.filter((body: JSONObject) => {
    return body["isPartial"] !== true;
  });

  expect(finals).toHaveLength(1);
  expect(uploads[uploads.length - 1]).toBe(finals[0]);

  return finals[0]!;
}

/*
 * The final upload's statusMessage — and, asked of EVERY run in this file
 * rather than of one fixture, the column bound. A note is only worth adding if
 * it can never push the upload past what the server stores.
 */
function finalStatusMessage(): string {
  const message: string = finalUpload()["statusMessage"] as string;

  expect(typeof message).toBe("string");
  expect(message.length).toBeLessThanOrEqual(MAX_STATUS_MESSAGE_LENGTH);

  return message;
}

function uploadedDevices(body: JSONObject): Array<DiscoveredHost> {
  return body["discoveredDevices"] as unknown as Array<DiscoveredHost>;
}

describe("runScan — a reverse-DNS pass cut short by its time budget", () => {
  /*
   * 1,500 hosts behind a slow resolver: the pass got 20 waves of 32 in before
   * its budget ran out and named 200 of the 640 addresses it reached.
   */
  const HOST_COUNT: number = 1500;
  const NAMED_COUNT: number = 200;
  const LOOKED_UP_COUNT: number = 640;

  beforeEach(() => {
    scanSpy.mockResolvedValue(
      makeSnmpResult(makeHosts(HOST_COUNT, 10)) as never,
    );
  });

  test("uploads success with every host, and the note after the sweep's own sentence", async () => {
    mockReverseDnsPass({
      namedCount: NAMED_COUNT,
      lookedUpCount: LOOKED_UP_COUNT,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeScan());

    const body: JSONObject = finalUpload();
    expect(body["success"]).toBe(true);
    expect(body["scanId"]).toBe(scanId.toString());
    expect(body["scannedHostCount"]).toBe(4094);
    expect(uploadedDevices(body)).toHaveLength(HOST_COUNT);

    /*
     * Exact, because every figure in it comes from a different field of the
     * verdict: named from the hosts actually stamped, 1,500 from the distinct
     * addresses, 860 from notLookedUpCount (NOT the 1,300 left without a
     * name — most of those were asked and have no PTR record), and "1m 43s"
     * from the budget the resolver sized for 1,500 addresses. A field dropped
     * anywhere between the seam and the upload changes this sentence.
     *
     * It says the 860 were never looked up, and deliberately NOT that they
     * are "listed by IP address": ten of these hosts carry an SNMP sysName, and
     * NetBIOS can still name the rest, so that claim would be false exactly
     * when the other sources did their job.
     */
    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 10 answered SNMP. " +
        "Reverse DNS named 200 of 1,500 hosts before its 1m 43s time limit; " +
        "860 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
    expect(message).not.toContain("listed by IP address");
  });

  test("the hosts the pass did name still carry their dnsHostname", async () => {
    mockReverseDnsPass({
      namedCount: NAMED_COUNT,
      lookedUpCount: LOOKED_UP_COUNT,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeScan());

    const devices: Array<DiscoveredHost> = uploadedDevices(finalUpload());

    /*
     * A cut-short pass is still a pass: the names it found before the budget
     * ran out are real, and the note must not become the reason they are
     * dropped.
     */
    expect(devices[0]!.dnsHostname).toBe("host-1.corp.example.com");
    expect(devices[NAMED_COUNT - 1]!.dnsHostname).toBe(
      `host-${NAMED_COUNT}.corp.example.com`,
    );
    expect(devices[NAMED_COUNT]).not.toHaveProperty("dnsHostname");
    expect(devices[HOST_COUNT - 1]).not.toHaveProperty("dnsHostname");
    expect(
      devices.filter((device: DiscoveredHost) => {
        return Boolean(device.dnsHostname);
      }),
    ).toHaveLength(NAMED_COUNT);
    // The sweep's own findings ride along untouched.
    expect(devices[0]!.sysName).toBe("core-switch-1");
  });

  /*
   * The Config -> seam wiring the note's advice depends on. The message tells
   * the operator to raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS; unset (as
   * here) it must reach the pass as "no fixed budget", so the resolver sizes
   * one to the hosts rather than running every sweep under a flat minute.
   */
  test("with the budget variable unset, the pass is asked for every host and handed no fixed budget", async () => {
    const calls: Array<ReverseDnsPassCall> = mockReverseDnsPass({
      namedCount: NAMED_COUNT,
      lookedUpCount: LOOKED_UP_COUNT,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeScan());

    expect(calls).toHaveLength(1);
    expect(calls[0]!.ipAddresses).toHaveLength(HOST_COUNT);
    expect(calls[0]!.options).toEqual({ totalBudgetInMs: undefined });
  });

  test("an ICMP-only scan carries the note too", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(300), { scannedHostCount: 1022 }) as never,
    );
    mockReverseDnsPass({
      namedCount: 25,
      lookedUpCount: 128,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeIcmpOnlyScan());

    /*
     * The ping-only case is the one where this matters most: those hosts have
     * no sysName to fall back on, so a host reverse DNS never reached is a
     * bare address in the Review dialog. The sized budget for 300 addresses
     * is the one-minute floor.
     */
    expect(finalUpload()["success"]).toBe(true);
    expect(finalStatusMessage()).toBe(
      "Swept 1022 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS named 25 of 300 hosts before its 1m time limit; " +
        "172 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
  });

  /*
   * Two caveats on one message, and the ingest endpoint clips from the end.
   * The stopped-early caveat has always led so the clip cannot eat it; the
   * naming note follows the headline. Here all three fit, so the FULL note is
   * the one uploaded and nothing is cut: exact, so a composition that
   * reached for the compact note (or clipped) while there was room fails.
   */
  test("an ICMP-only sweep that also stopped early keeps its caveat first and the note last", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(300), {
        scannedHostCount: 1022,
        isIcmpSweepIncomplete: true,
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 25,
      lookedUpCount: 128,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeIcmpOnlyScan());

    const message: string = finalStatusMessage();
    expect(message.indexOf("This ping sweep stopped early")).toBe(0);
    expect(message).toBe(
      INCOMPLETE_ICMP_SWEEP_CAVEAT +
        " " +
        "Swept 1022 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS named 25 of 300 hosts before its 1m time limit; " +
        "172 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
  });

  /*
   * The advice to raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS is only
   * advice while raising it is possible. Config refuses a value above
   * MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS (20 minutes) and falls back to
   * AUTOMATIC sizing, which is capped at ten, so telling the operator of a
   * pass that already ran under the maximum to raise it would send them to
   * CUT their budget in half.
   *
   * The budget comes from what the seam REPORTS, not from Config: the variable
   * is unset in this file, and the message must describe the pass that ran.
   */
  test("a pass that ran under the maximum budget override uploads no advice to raise it", async () => {
    mockReverseDnsPass({
      namedCount: NAMED_COUNT,
      lookedUpCount: LOOKED_UP_COUNT,
      isTimeBudgetExhausted: true,
      totalBudgetInMs: 1200000,
    });

    await runScan(makeScan());

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 10 answered SNMP. " +
        "Reverse DNS named 200 of 1,500 hosts before its 20m time limit; " +
        "860 were never looked up.",
    );
    expect(message).not.toContain("PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS");
  });

  /*
   * The other side of that boundary, so the test above cannot pass because
   * the advice was dropped for every fixed budget. A second under the maximum
   * is still a budget the variable can raise.
   */
  test("a pass that ran just under the maximum budget override still uploads the advice", async () => {
    mockReverseDnsPass({
      namedCount: NAMED_COUNT,
      lookedUpCount: LOOKED_UP_COUNT,
      isTimeBudgetExhausted: true,
      totalBudgetInMs: 1199000,
    });

    await runScan(makeScan());

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 10 answered SNMP. " +
        "Reverse DNS named 200 of 1,500 hosts before its 19m 59s time limit; " +
        "860 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
  });
});

describe("runScan — a reverse-DNS pass whose resolver never answered", () => {
  beforeEach(() => {
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(300)) as never);
  });

  test("uploads the 'got no answers' note, naming the resolver and the zone rather than the budget", async () => {
    // Two waves of 32 exhausted the failure budget; the rest were skipped.
    mockReverseDnsPass({
      namedCount: 0,
      lookedUpCount: 64,
      isReverseDnsAvailable: false,
    });

    await runScan(makeIcmpOnlyScan());

    /*
     * No reason reported, so no parentheses: an empty "()" would read as a
     * reason that got lost on the way.
     */
    expect(finalUpload()["success"]).toBe(true);
    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS lookups from this probe got no answers, so none of the 300 hosts got a reverse DNS name " +
        "- check the probe's DNS resolver and the reverse DNS zone for this range.",
    );
    expect(message).not.toContain("()");
  });

  /*
   * The verdict means only that the first waves of lookups ALL failed, which a
   * broken probe resolver and a reverse zone delegated to a dead nameserver
   * both produce. The resolver's own reason (ESERVFAIL here, from a healthy
   * resolver relaying a broken zone) is the one thing on the message that
   * tells those apart, so it has to survive the whole trip: seam ->
   * ReverseDnsNamingOutcome.failureReason -> note -> upload, trimmed, and
   * without its trailing period doubling the sentence's punctuation.
   */
  test("the resolver's failure reason reaches the uploaded 'got no answers' note", async () => {
    mockReverseDnsPass({
      namedCount: 0,
      lookedUpCount: 64,
      isReverseDnsAvailable: false,
      failureReason: "queryPtr ESERVFAIL 10.0.0.1.",
    });

    await runScan(makeIcmpOnlyScan());

    expect(finalUpload()["success"]).toBe(true);
    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS lookups from this probe got no answers (queryPtr ESERVFAIL 10.0.0.1), " +
        "so none of the 300 hosts got a reverse DNS name " +
        "- check the probe's DNS resolver and the reverse DNS zone for this range.",
    );
    expect(message).not.toContain("10.0.0.1.)");
  });

  /*
   * A dead resolver on a big sweep can ALSO run the clock out. Telling that
   * operator to raise the budget would send them to the one knob that cannot
   * help: more time asking a resolver that answers nothing names nothing.
   */
  test("does not advise raising the budget when the time limit was also hit", async () => {
    mockReverseDnsPass({
      namedCount: 0,
      lookedUpCount: 64,
      isReverseDnsAvailable: false,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeIcmpOnlyScan());

    const message: string = finalStatusMessage();
    expect(message).toContain(
      "Reverse DNS lookups from this probe got no answers",
    );
    expect(message).not.toContain("time limit");
    expect(message).not.toContain("PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS");
  });
});

describe("runScan — a reverse-DNS pass that threw", () => {
  /*
   * Unreachable by design (the resolver never rejects) and caught anyway,
   * because a throw on the way out of a completed sweep must not lose its
   * results. What it may not do either is put a class name on the operator's
   * message: `new Error("")` used to fall back to String(error) and upload
   * "(Error)", while `new Error(" ")` said "unknown error" about the same
   * nothing.
   */
  beforeEach(() => {
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(300)) as never);
  });

  test("a seam that throws an Error with an empty message uploads '(unknown error)' and keeps every host", async () => {
    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error("") as never);

    await runScan(makeIcmpOnlyScan());

    // The throwing double really was the pass that ran.
    expect(SubnetScanner.resolveReverseDnsHostnames).toHaveBeenCalledTimes(1);

    const body: JSONObject = finalUpload();
    expect(body["success"]).toBe(true);
    expect(uploadedDevices(body)).toHaveLength(300);

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS lookups failed on this probe (unknown error), " +
        "so none of the 300 hosts got a reverse DNS name.",
    );
    expect(message).not.toContain("(Error)");
  });
});

describe("runScan — a healthy naming pass says nothing", () => {
  /*
   * Most addresses on most networks have no PTR record. A clause on every
   * scan that finished its pass would be noise on the healthy case and teach
   * operators to skip the sentence on the day it matters, so these pin the
   * message to EXACTLY the sweep summary it was before the note existed.
   *
   * "Healthy" is the load-bearing word (OneUptime issue #3916). These used to
   * stand for every pass that reached every host — including one whose
   * lookups timed out for some of them, which reported exactly the same
   * silence as a network with no PTR records. That silence is what the issue
   * was about. A pass that reached every host and was ANSWERED for every one,
   * named or not, still says nothing, and the "no PTR records" case below now
   * reports its per-host codes to prove it was answered; a pass whose lookups
   * failed is no longer healthy, and says so — see the
   * describe after this one.
   */
  beforeEach(() => {
    scanSpy.mockResolvedValue(makeSnmpResult(makeHosts(1500, 10)) as never);
  });

  test("a pass that reached every host and named most of them adds no note", async () => {
    mockReverseDnsPass({ namedCount: 1200, lookedUpCount: 1500 });

    await runScan(makeScan());

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 10 answered SNMP.",
    );
    expect(message).not.toContain("Reverse DNS");
    expect(
      uploadedDevices(finalUpload()).filter((device: DiscoveredHost) => {
        return Boolean(device.dnsHostname);
      }),
    ).toHaveLength(1200);
  });

  test("a pass that reached every host and found no PTR records adds no note either", async () => {
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 1500 });

    await runScan(makeScan());

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 10 answered SNMP.",
    );
  });

  /*
   * The same pass as a resolver that reports its per-address codes describes
   * it (OneUptime issue #3916): every address answered, none with a record,
   * zero failures. Still silent — the design this whole describe pins — while
   * every host left unnamed carries "no-record" for its tooltip. That split is
   * the fix: the fact about each address goes on the address, and the
   * message is kept for what a rescan could change.
   */
  test("a pass that reports 'no PTR record' for every unnamed host, and no failures, still adds no note", async () => {
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 1500, failedCount: 0 });

    await runScan(makeScan());

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 10 answered SNMP.",
    );

    const devices: Array<DiscoveredHost> = uploadedDevices(finalUpload());

    // The ten SNMP hosts are named by sysName and so carry no code.
    for (const device of devices.slice(0, 10)) {
      expect(device).not.toHaveProperty("dnsHostnameStatus");
    }

    // Everyone else was answered "no record", and says so.
    expect(
      devices.slice(10).every((device: DiscoveredHost) => {
        return (
          device.dnsHostnameStatus === DiscoveredHostReverseDnsStatus.NoRecord
        );
      }),
    ).toBe(true);
  });

  test("an opted-in NetBIOS lookup that asked every unnamed host adds no note", async () => {
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 1500 });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 40,
      queriedCount: 1490,
    });

    await runScan(makeScan({ isNetbiosLookupEnabled: true }));

    // It ran — that is what makes its silence on the message mean something.
    expect(netbiosCalls).toHaveLength(1);
    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 10 answered SNMP.",
    );
    expect(message).not.toContain("NetBIOS");
  });
});

describe("runScan — reverse DNS lookups that failed (OneUptime issue #3916)", () => {
  /*
   * The reported scan: twelve kitchen displays answered ping on an ICMP-only
   * sweep, four came back with PTR names, and the Review dialog listed the
   * other eight by address under a status message that said nothing but
   * "12 answered ping". Whether those eight had no PTR record or the probe's
   * DNS server simply did not answer was unknowable from anything the product
   * showed.
   *
   * The message now says so when lookups FAILED — the case a rescan can fix,
   * and the one that looked identical to a network with no records. The
   * per-host reason rides on each host for the Review dialog's tooltip.
   */
  const CUSTOMER_HEADLINE: string =
    "Swept 15 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping.";

  test("the reported scan: 4 of 12 named, 2 timed out, 6 with no record — the message names the 2, the hosts carry their codes", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(12), { scannedHostCount: 15 }) as never,
    );
    mockReverseDnsPass({ namedCount: 4, lookedUpCount: 12, failedCount: 2 });

    await runScan(makeIcmpOnlyScan());

    const body: JSONObject = finalUpload();
    expect(body["success"]).toBe(true);

    /*
     * Exact. Before this fix the message was the headline alone — byte for
     * byte what the customer's screenshot shows — and the two timeouts were
     * indistinguishable from the six addresses with no record.
     */
    expect(finalStatusMessage()).toBe(
      `${CUSTOMER_HEADLINE} ` +
        "Reverse DNS lookups failed for 2 of 12 hosts; " +
        "hover the (i) beside an unnamed host for the reason, and rescan to try again.",
    );

    const devices: Array<DiscoveredHost> = uploadedDevices(body);
    expect(devices).toHaveLength(12);

    // Named: a name, and no code — a named host needs no explanation.
    for (const device of devices.slice(0, 4)) {
      expect(device.dnsHostname).toEqual(expect.any(String));
      expect(device).not.toHaveProperty("dnsHostnameStatus");
    }

    expect(
      devices.slice(4).map((device: DiscoveredHost) => {
        return device.dnsHostnameStatus;
      }),
    ).toEqual([
      DiscoveredHostReverseDnsStatus.Timeout,
      DiscoveredHostReverseDnsStatus.Timeout,
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.NoRecord,
    ]);

    // The note never claims those hosts are listed by address: see the builder.
    expect(finalStatusMessage()).not.toContain("listed by");
  });

  test("the same scan with EVERY lookup failed reads 'all 12 hosts', below the 64 failures that would call the resolver unusable", async () => {
    /*
     * Twelve straight failures are far short of the resolver's 64-failure
     * breaker, so the pass still reports itself available and complete. It
     * used to be the loudest silence of all: no name for anyone, and a
     * message indistinguishable from a network with no reverse zone.
     */
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(12), { scannedHostCount: 15 }) as never,
    );
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 12, failedCount: 12 });

    await runScan(makeIcmpOnlyScan());

    expect(finalStatusMessage()).toBe(
      `${CUSTOMER_HEADLINE} ` +
        "Reverse DNS lookups failed for all 12 hosts; " +
        "hover the (i) beside an unnamed host for the reason, and rescan to try again.",
    );
    expect(
      uploadedDevices(finalUpload()).every((device: DiscoveredHost) => {
        return (
          device.dnsHostnameStatus === DiscoveredHostReverseDnsStatus.Timeout
        );
      }),
    ).toBe(true);
  });

  test("hosts named by SNMP are counted among the failed lookups but carry no code", async () => {
    /*
     * Reverse DNS asks about every host, sysName or not, so a failed lookup
     * for an SNMP-named switch is a real failure and is counted. But that
     * switch is named, the dialog shows it no hint, and a code on it would be
     * a status nobody reads — so the code goes only on the unnamed.
     */
    scanSpy.mockResolvedValue(makeSnmpResult(makeHosts(20, 5)) as never);
    // The double fails the five SNMP hosts first: they lead the address list.
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 20, failedCount: 8 });

    await runScan(makeScan());

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts: 20 answered ICMP ping, 5 answered SNMP. " +
        "Reverse DNS lookups failed for 8 of 20 hosts; " +
        "hover the (i) beside an unnamed host for the reason, and rescan to try again.",
    );

    const devices: Array<DiscoveredHost> = uploadedDevices(finalUpload());

    for (const device of devices.slice(0, 5)) {
      expect(device.sysName).toEqual(expect.any(String));
      expect(device).not.toHaveProperty("dnsHostnameStatus");
    }

    expect(devices[5]!.dnsHostnameStatus).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(devices[7]!.dnsHostnameStatus).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(devices[8]!.dnsHostnameStatus).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
  });

  test("a pass that ran out of time AND had lookups fail says both, the time limit first", async () => {
    /*
     * Two different reasons for two different sets of hosts, with two
     * different fixes: 172 were never asked (raise the budget), 40 were asked
     * and not answered (rescan, or look at the probe's DNS). One sentence
     * each; the time limit leads because it is the one with a knob.
     */
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(300)) as never);
    mockReverseDnsPass({
      namedCount: 25,
      lookedUpCount: 128,
      isTimeBudgetExhausted: true,
      failedCount: 40,
    });

    await runScan(makeIcmpOnlyScan());

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS named 25 of 300 hosts before its 1m time limit; 172 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer). " +
        "Reverse DNS lookups failed for 40 of 300 hosts; " +
        "hover the (i) beside an unnamed host for the reason, and rescan to try again.",
    );

    // And each unnamed host says which of the three it was.
    const devices: Array<DiscoveredHost> = uploadedDevices(finalUpload());
    expect(devices[25]!.dnsHostnameStatus).toBe(
      DiscoveredHostReverseDnsStatus.Timeout,
    );
    expect(devices[65]!.dnsHostnameStatus).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
    expect(devices[128]!.dnsHostnameStatus).toBe(
      DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
    );
  });

  test("failures beside a NetBIOS cap: reverse DNS first, then NetBIOS", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(2500)) as never);
    mockReverseDnsPass({
      namedCount: 0,
      lookedUpCount: 2500,
      failedCount: 30,
    });
    mockNetbiosPass({
      namedCount: 150,
      queriedCount: 2000,
      isHostCapReached: true,
      maxHosts: 2000,
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 2500 answered ping. " +
        "Reverse DNS lookups failed for 30 of 2,500 hosts; " +
        "hover the (i) beside an unnamed host for the reason, and rescan to try again. " +
        "NetBIOS lookups are capped at 2,000 hosts per scan, so 500 unnamed hosts were not asked " +
        "(raise PROBE_DISCOVERY_NETBIOS_MAX_HOSTS on the probe to ask more).",
    );
  });

  test("a resolver judged unusable says only that, whatever failure count it also reports", async () => {
    /*
     * "Got no answers" already explains every host, with the resolver's own
     * reason and where to look. A second sentence counting the same failures
     * would say the same thing worse.
     */
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(300)) as never);
    mockReverseDnsPass({
      namedCount: 0,
      lookedUpCount: 64,
      isReverseDnsAvailable: false,
      failureReason: "queryPtr ETIMEOUT",
      failedCount: 64,
    });

    await runScan(makeIcmpOnlyScan());

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS lookups from this probe got no answers (queryPtr ETIMEOUT), so none of the 300 hosts got a reverse DNS name - " +
        "check the probe's DNS resolver and the reverse DNS zone for this range.",
    );
    expect(message).not.toContain("failed for");
  });

  test("a pass that threw, on a resolution that reported failures, reports the throw alone", async () => {
    /*
     * The throw path's verdict is `error` and nothing else — the scanner never
     * carries a failure count onto it — so the operator gets one explanation
     * for the unnamed hosts rather than two that disagree.
     */
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(300)) as never);

    const nameTable: Map<string, string> = new Map<string, string>();

    nameTable.get = (): string | undefined => {
      throw new Error("name table went away");
    };

    jest.spyOn(SubnetScanner, "resolveReverseDnsHostnames").mockResolvedValue({
      hostnameByIpAddress: nameTable,
      isReverseDnsAvailable: true,
      isTimeBudgetExhausted: false,
      lookedUpCount: 300,
      notLookedUpCount: 0,
      totalBudgetInMs: 60000,
      failedAddressCount: 12,
    });

    await runScan(makeIcmpOnlyScan());

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 300 answered ping. " +
        "Reverse DNS lookups failed on this probe (name table went away), " +
        "so none of the 300 hosts got a reverse DNS name.",
    );
    expect(message).not.toContain("failed for");
  });

  /*
   * The pile-up shape: a multi-credential sweep behind an ICMP filter with a
   * long quoted SNMP error is already past the column before any note. The
   * ladder has to keep what it always kept — the headline whole, the compact
   * note whole at the end, one marked cut in between — with the new sentence
   * in its compact form, and the tooltip advice (which only the full form
   * carries) dropped rather than clipped.
   */
  test("on a crowded message the failure sentence goes compact, whole, at the end, and the headline survives", async () => {
    scanSpy.mockResolvedValue(
      makeSnmpResult(makeHosts(1500, 12), {
        scannedHostCount: 65534,
        icmpFilteredFallbackHostCount: 64034,
        snmpErrorHostCount: 480,
        mostCommonSnmpError:
          "Error: Authentication failure (incorrect password, community or key) from agent 10.20.3.7 while reading sysName.0 on udp",
        responderCountByConfigId: { c1: 5, c2: 4, c3: 3 },
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 200,
      lookedUpCount: 1500,
      failedCount: 90,
    });

    await runScan(
      makeScan({
        snmpConfigs: [
          "Headquarters building core distribution switches",
          "Warehouse and loading dock access layer switches",
          "Data centre row C top-of-rack switches",
          "Retail branch offices wireless controllers",
        ].map((name: string, index: number): JSONObject => {
          return {
            id: `c${index + 1}`,
            name: name,
            snmpVersion: "V2c",
            snmpCommunityString: `community-${index + 1}`,
          };
        }),
      }),
    );

    const message: string = finalStatusMessage();
    const compactNote: string =
      "Reverse DNS failed for 90 of 1,500 hosts; rescan to retry.";

    expect(
      message.indexOf(
        "Swept 65534 hosts: 1500 answered ICMP ping, 12 answered SNMP. ",
      ),
    ).toBe(0);
    expect(message.endsWith(` ${compactNote}`)).toBe(true);
    expect(message).not.toContain("hover the (i)");
    expect(message).not.toContain("lookups failed for");
    // At most one marked cut, and the column holds.
    expect(message.split("…").length).toBeLessThanOrEqual(2);
    expect(message.length).toBeLessThanOrEqual(MAX_STATUS_MESSAGE_LENGTH);
    // No secret made it onto the message on the way.
    expect(message).not.toContain("community-1");
  });
});

describe("runScan — a NetBIOS lookup cut short", () => {
  /*
   * The cap is the commonest way this lookup stops short on a large estate,
   * and unlike the reverse-DNS budget it has a knob of its own. Saying "2,000
   * were not asked" without naming PROBE_DISCOVERY_NETBIOS_MAX_HOSTS leaves
   * the operator with a number and nothing to do about it.
   */
  test("a lookup stopped by its host cap uploads the cap note, naming the knob that raises it", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(2500)) as never);
    // Reverse DNS finishes and names nobody: all 2,500 go on to NetBIOS.
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 2500 });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 150,
      queriedCount: 2000,
      isHostCapReached: true,
      maxHosts: 2000,
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(netbiosCalls).toHaveLength(1);
    expect(netbiosCalls[0]!.ipAddresses).toHaveLength(2500);

    /*
     * 500 = eligible minus the cap, NOT the 2,350 hosts left without a name:
     * the 1,850 that were asked and stayed silent are UDP 137 doing what it
     * does, and are no reason to write a sentence.
     *
     * 2,000 is the resolver's built-in cap, well under the ceiling the knob
     * accepts, so the advice to raise it is real advice here.
     */
    expect(finalUpload()["success"]).toBe(true);
    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 2500 answered ping. " +
        "NetBIOS lookups are capped at 2,000 hosts per scan, so 500 unnamed hosts were not asked " +
        "(raise PROBE_DISCOVERY_NETBIOS_MAX_HOSTS on the probe to ask more).",
    );

    const devices: Array<DiscoveredHost> = uploadedDevices(finalUpload());
    expect(devices).toHaveLength(2500);
    expect(devices[0]!.netbiosName).toBe("ws1");
    expect(devices[2499]).not.toHaveProperty("netbiosName");
  });

  /*
   * The other side of that advice. MAX_NETBIOS_MAX_HOSTS_OVERRIDE is where the
   * knob stops — past it the lookup would be truncated by its own clock rather
   * than by the cap, which is the silent failure this note exists to report —
   * so a lookup already running AT the ceiling must not be told to raise it.
   */
  test("a lookup already capped at the ceiling the knob accepts uploads the cap note without the advice", async () => {
    expect(MAX_NETBIOS_MAX_HOSTS_OVERRIDE).toBe(4000);

    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(4200), {
        scannedHostCount: 65534,
      }) as never,
    );
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 4200 });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 60,
      queriedCount: MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
      isHostCapReached: true,
      maxHosts: MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
    });

    // A /16, because 4,200 hosts do not fit the /20 the other fixtures use.
    await runScan(
      makeIcmpOnlyScan({
        cidr: "10.20.0.0/16",
        isNetbiosLookupEnabled: true,
      }),
    );

    expect(netbiosCalls).toHaveLength(1);
    expect(netbiosCalls[0]!.ipAddresses).toHaveLength(4200);

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 65534 hosts with ICMP ping only (Check SNMP is off for this scan): 4200 answered ping. " +
        "NetBIOS lookups are capped at 4,000 hosts per scan, so 200 unnamed hosts were not asked.",
    );
    expect(message).not.toContain("PROBE_DISCOVERY_NETBIOS_MAX_HOSTS");
  });

  /*
   * A socket that could not be used also reports its budget as spent — it
   * waited out the whole window hearing nothing. "Raise the time limit" is
   * the wrong advice for a probe that cannot send UDP 137, so the socket's
   * reason has to win, trimmed, with the names it managed before it failed.
   */
  test("a lookup whose UDP socket failed uploads the socket-failure note, not a time limit", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(40)) as never);
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 40 });
    mockNetbiosPass({
      namedCount: 3,
      queriedCount: 12,
      isTimeBudgetExhausted: true,
      failureReason: "  send ENETUNREACH 10.20.0.13:137  ",
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 40 answered ping. " +
        "NetBIOS lookups stopped because the probe's UDP socket failed (send ENETUNREACH 10.20.0.13:137) after naming 3 hosts.",
    );
    expect(message).not.toContain("time limit");
  });

  /*
   * A socket that never BOUND is the other shape of the same failure, and the
   * one a probe without UDP permissions really produces: NetbiosNameResolver
   * reports its budget spent, nothing queried, and the reason as a whole
   * sentence. The lookups did not "stop" (they never started), and the
   * sentence's own period must not end up inside the parentheses.
   */
  test("a lookup whose UDP socket never bound uploads the 'did not run' note", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(40)) as never);
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 40 });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 0,
      queriedCount: 0,
      isTimeBudgetExhausted: true,
      failureReason: "The UDP socket did not bind in time.",
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    // Asked, for every host reverse DNS left unnamed.
    expect(netbiosCalls).toHaveLength(1);
    expect(netbiosCalls[0]!.ipAddresses).toHaveLength(40);

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 40 answered ping. " +
        "NetBIOS lookups did not run because the probe's UDP socket failed (The UDP socket did not bind in time).",
    );
    expect(message).not.toContain("stopped");
    expect(message).not.toContain("time limit");
  });

  /*
   * A global probe never sends NetBIOS queries, whatever the row says. The
   * double below would report a capped lookup if it were asked, so a CAP note
   * on this message could only mean the guard was skipped — or that a verdict
   * from a lookup that never ran was invented on the way to the upload.
   *
   * This used to pin total silence about NetBIOS here, and that silence was
   * half of OneUptime issue #3916: the operator ticked "NetBIOS name lookup",
   * got bare addresses back, and nothing said the lookup had never run — on
   * the bundled self-hosted probes, which register as global, that is every
   * scan. The guard stands; the message now says it fired, in one fixed
   * sentence, and each host the lookup would have asked carries the reason.
   */
  test("a global probe with the flag on is never asked, and says so instead of reporting a lookup it did not run", async () => {
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(2500)) as never);
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 2500 });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 150,
      queriedCount: 2000,
      isHostCapReached: true,
      maxHosts: 2000,
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(netbiosCalls).toEqual([]);
    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 2500 answered ping. " +
        "NetBIOS names were not looked up: this is a global probe, and global probes never send NetBIOS queries.",
    );
    // Nothing from the double's verdict leaked through: it was never asked.
    expect(message).not.toContain("capped");
    expect(message).not.toContain("2,000");
    expect(message).not.toContain("PROBE_DISCOVERY_NETBIOS_MAX_HOSTS");

    const devices: Array<DiscoveredHost> = uploadedDevices(finalUpload());
    expect(devices[0]).not.toHaveProperty("netbiosName");
    expect(
      devices.every((device: DiscoveredHost) => {
        return (
          device.netbiosNameStatus ===
          DiscoveredHostNetbiosStatus.SkippedGlobalProbe
        );
      }),
    ).toBe(true);
  });

  test("a global probe whose sweep left nobody unnamed says nothing about NetBIOS", async () => {
    /*
     * NetBIOS only ever asks hosts SNMP and reverse DNS left unnamed. With
     * none, a custom probe would have sent nothing either, so "it was not
     * looked up" would explain a gap that does not exist.
     */
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(40)) as never);
    mockReverseDnsPass({ namedCount: 40, lookedUpCount: 40 });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 40 answered ping.",
    );
    expect(
      uploadedDevices(finalUpload()).some((device: DiscoveredHost) => {
        return "netbiosNameStatus" in device;
      }),
    ).toBe(false);
  });

  test("a global probe on a scan that did not opt in says nothing about NetBIOS and stamps nothing", async () => {
    /*
     * The skip sentence is about a lookup the operator ASKED for. A scan with
     * NetBIOS off is described by its own toggle, on the dashboard; saying
     * "not looked up" on every such scan would be noise.
     */
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(40)) as never);
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 40 });

    for (const scan of [
      makeIcmpOnlyScan(),
      makeIcmpOnlyScan({ isNetbiosLookupEnabled: false }),
    ]) {
      fetchSpy.mockClear();

      await runScan(scan);

      expect(finalStatusMessage()).not.toContain("NetBIOS");
      expect(
        uploadedDevices(finalUpload()).some((device: DiscoveredHost) => {
          return "netbiosNameStatus" in device;
        }),
      ).toBe(false);
    }
  });

  test("a global probe with failed reverse DNS lookups says both, reverse DNS first", async () => {
    // The reported scan, on the bundled global probe with NetBIOS ticked.
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(12), { scannedHostCount: 15 }) as never,
    );
    mockReverseDnsPass({ namedCount: 4, lookedUpCount: 12, failedCount: 2 });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(finalStatusMessage()).toBe(
      "Swept 15 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping. " +
        "Reverse DNS lookups failed for 2 of 12 hosts; " +
        "hover the (i) beside an unnamed host for the reason, and rescan to try again. " +
        "NetBIOS names were not looked up: this is a global probe, and global probes never send NetBIOS queries.",
    );

    const devices: Array<DiscoveredHost> = uploadedDevices(finalUpload());

    // The four named hosts carry neither code; the eight unnamed carry both.
    for (const device of devices.slice(0, 4)) {
      expect(device).not.toHaveProperty("dnsHostnameStatus");
      expect(device).not.toHaveProperty("netbiosNameStatus");
    }

    for (const device of devices.slice(4)) {
      expect(device.dnsHostnameStatus).toEqual(expect.any(String));
      expect(device.netbiosNameStatus).toBe(
        DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
      );
    }
  });

  test("a scan that did not opt in is never asked, and says nothing about NetBIOS", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(2500)) as never);
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 2500 });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 0,
      queriedCount: 2000,
      isHostCapReached: true,
      maxHosts: 2000,
    });

    await runScan(makeIcmpOnlyScan());

    expect(netbiosCalls).toEqual([]);
    expect(finalStatusMessage()).not.toContain("NetBIOS");
  });
});

describe("runScan — the NetBIOS host cap the seam is asked for", () => {
  /*
   * PROBE_DISCOVERY_NETBIOS_MAX_HOSTS -> Config -> scanWithDeadline ->
   * SubnetScanner.attachNetbiosNames -> the resolveNetbiosNames seam. Every
   * step of that is invisible from the status message, and a break anywhere
   * along it leaves the cap note telling the operator to set a variable the
   * lookup never reads.
   */
  test("with the variable unset, the seam is asked with an options object carrying no cap", async () => {
    // The file deletes it before any import; assert it, so this test means what it says.
    expect(process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"]).toBeUndefined();

    scanSpy.mockResolvedValue(makeIcmpOnlyResult(makeHosts(40)) as never);
    mockReverseDnsPass({ namedCount: 0, lookedUpCount: 40 });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 4,
      queriedCount: 40,
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(netbiosCalls).toHaveLength(1);

    /*
     * `undefined`, and specifically not the Config default of 0 and not a NaN
     * from an unparsed value: NetbiosNameResolver reads a non-finite cap as
     * "no cap at all" and would pace queries to every host handed to it, while
     * 0 would clamp to one host. Undefined is the only value that means "use
     * DEFAULT_NETBIOS_MAX_HOSTS", which is what an unset variable must do.
     */
    expect(netbiosCalls[0]!.options).toBeDefined();
    expect(netbiosCalls[0]!.options).toEqual({ maxHosts: undefined });
    expect(netbiosCalls[0]!.options?.maxHosts).toBeUndefined();

    // Nothing to confess, so no note: an unset knob is the healthy case.
    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts with ICMP ping only (Check SNMP is off for this scan): 40 answered ping.",
    );
  });

  /*
   * The raised cap, end to end. Config.ts reads the variable once at load, so
   * this drives a freshly loaded module graph — and the doubles go on THAT
   * graph's SubnetScanner, API and logger, which are the ones its runScan
   * calls. A fresh SubnetScanner is a different object from this file's, so
   * the file-wide stub does NOT cover it; both naming seams are stubbed
   * explicitly below before anything can reach a resolver or a UDP socket.
   */
  test("a probe with the variable set asks the seam for that cap and uploads a note naming it", async () => {
    const originalValue: string | undefined =
      process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"];

    process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = "3000";

    /*
     * Held on an object: a bare `let` assigned inside the callback stays
     * narrowed to its initial undefined outside it.
     */
    const fresh: {
      runScan?: typeof runScan;
      scanner?: typeof SubnetScanner;
      api?: typeof API;
      logger?: typeof logger;
    } = {};

    try {
      jest.isolateModules(() => {
        fresh.runScan = (
          jest.requireActual("../../../Jobs/Discovery/FetchScans") as {
            runScan: typeof runScan;
          }
        ).runScan;
        fresh.scanner = (
          jest.requireActual("../../../Utils/Discovery/SubnetScanner") as {
            default: typeof SubnetScanner;
          }
        ).default;
        fresh.api = (
          jest.requireActual("Common/Utils/API") as { default: typeof API }
        ).default;
        fresh.logger = (
          jest.requireActual("Common/Server/Utils/Logger") as {
            default: typeof logger;
          }
        ).default;
      });

      const scanner: typeof SubnetScanner = fresh.scanner!;

      // A different module instance from the file's spies, which is the point.
      expect(scanner).not.toBe(SubnetScanner);

      for (const level of ["debug", "warn", "error"] as const) {
        jest.spyOn(fresh.logger!, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      const freshFetchSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(fresh.api!, "fetch")
        .mockResolvedValue({ data: [] } as never);

      jest.spyOn(scanner, "scan").mockResolvedValue(
        makeIcmpOnlyResult(makeHosts(3200), {
          scannedHostCount: 65534,
        }) as never,
      );
      /*
       * The fresh graph's reverse-DNS seam. Stubbed before the sweep runs, not
       * because this test is about it, but because the fresh SubnetScanner is
       * outside the reach of stubReverseDnsAsResolvingNothing above and a
       * completed sweep ends in a PTR query per host otherwise.
       */
      jest
        .spyOn(scanner, "resolveReverseDnsHostnames")
        .mockImplementation(
          async (ipAddresses: Array<string>): Promise<ReverseDnsResolution> => {
            return {
              hostnameByIpAddress: new Map<string, string>(),
              isReverseDnsAvailable: true,
              isTimeBudgetExhausted: false,
              lookedUpCount: new Set<string>(ipAddresses).size,
              notLookedUpCount: 0,
              totalBudgetInMs: getReverseDnsTotalBudgetInMs({
                addressCount: new Set<string>(ipAddresses).size,
              }),
            };
          },
        );
      const netbiosCalls: Array<NetbiosPassCall> = installNetbiosDouble(
        scanner,
        {
          namedCount: 45,
          queriedCount: 3000,
          isHostCapReached: true,
          maxHosts: 3000,
        },
      );

      await fresh.runScan!(
        makeIcmpOnlyScan({
          cidr: "10.20.0.0/16",
          isNetbiosLookupEnabled: true,
        }),
      );

      // The configured cap, parsed by Config and carried the whole way down.
      expect(netbiosCalls).toHaveLength(1);
      expect(netbiosCalls[0]!.options).toEqual({ maxHosts: 3000 });
      expect(netbiosCalls[0]!.ipAddresses).toHaveLength(3200);

      const uploads: Array<JSONObject> = freshFetchSpy.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as JSONObject;
        })
        .filter((arg: JSONObject) => {
          return String(arg["url"]) === RESULT_URL;
        })
        .map((arg: JSONObject) => {
          return arg["data"] as JSONObject;
        });

      expect(uploads).toHaveLength(1);
      expect(uploads[0]!["success"]).toBe(true);

      /*
       * The note reports the cap the lookup RAN under - the operator's 3,000,
       * not the resolver's built-in 2,000 - and still names the knob, because
       * 3,000 is under the ceiling it accepts.
       */
      const message: string = uploads[0]!["statusMessage"] as string;
      expect(message.length).toBeLessThanOrEqual(MAX_STATUS_MESSAGE_LENGTH);
      expect(message).toBe(
        "Swept 65534 hosts with ICMP ping only (Check SNMP is off for this scan): 3200 answered ping. " +
          "NetBIOS lookups are capped at 3,000 hosts per scan, so 200 unnamed hosts were not asked " +
          "(raise PROBE_DISCOVERY_NETBIOS_MAX_HOSTS on the probe to ask more).",
      );
      expect(message).not.toContain("2,000");
    } finally {
      if (originalValue === undefined) {
        delete process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"];
      } else {
        process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = originalValue;
      }
    }
  });
});

describe("runScan — progress uploads never carry a naming note", () => {
  /*
   * A snapshot is taken DURING the sweep, before either naming pass has run,
   * so there is nothing for a note on it to describe. The sweep double below
   * reports progress the way SubnetScanner does — a copy of each host, so the
   * pass stamping names onto the final hosts cannot reach back into what the
   * partial upload already sent — and then settles.
   */
  test("the partial upload has no note and no names; the final one has both", async () => {
    const hosts: Array<DiscoveredHost> = makeHosts(300);

    scanSpy.mockImplementation(
      async (config: SubnetScanConfig): Promise<SubnetScanResult> => {
        await config.onProgress?.({
          sweptHostCount: 1022,
          phase: "icmp",
          phaseCompletedHostCount: 1022,
          phaseTotalHostCount: 4094,
          totalHostCount: 4094,
          discoveredHosts: hosts.map((host: DiscoveredHost) => {
            return { ...host };
          }),
          snmpResponderCount: 0,
          respondedToPingCount: hosts.length,
          isIcmpOnlySweep: true,
        });

        return makeIcmpOnlyResult(hosts);
      },
    );
    mockReverseDnsPass({
      namedCount: 25,
      lookedUpCount: 128,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeIcmpOnlyScan());

    const uploads: Array<JSONObject> = resultUploads();
    expect(uploads).toHaveLength(2);

    const partial: JSONObject = uploads[0]!;
    const partialMessage: string = partial["statusMessage"] as string;
    expect(partial["isPartial"]).toBe(true);
    expect(partialMessage.indexOf("Scan in progress")).toBe(0);
    expect(partialMessage).not.toContain("Reverse DNS");
    expect(partialMessage).not.toContain("NetBIOS");
    expect(partialMessage).not.toContain(
      "PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS",
    );
    expect(partialMessage.length).toBeLessThanOrEqual(
      MAX_STATUS_MESSAGE_LENGTH,
    );
    expect(
      uploadedDevices(partial).some((device: DiscoveredHost) => {
        return device.dnsHostname !== undefined;
      }),
    ).toBe(false);

    // The final upload is the one that says how naming went.
    expect(finalStatusMessage()).toContain(
      "Reverse DNS named 25 of 300 hosts before its 1m time limit",
    );
    expect(uploadedDevices(finalUpload())[0]!.dnsHostname).toBe(
      "host-1.corp.example.com",
    );
  });
});

describe("runScan — the uploaded message fits the column", () => {
  /*
   * The worst realistic pile-up: a /16 behind an ICMP filter, hundreds of
   * hosts rejecting the scan's credentials with a long error, reverse DNS out
   * of time AND NetBIOS both capped and out of time. Every sentence here is
   * one the builder writes on its own; together they are far past 500.
   *
   * What has to survive is decided, not left to the server's tail clip: the
   * headline leads whole, the COMPACT note (the full one is far longer) is
   * kept whole at the end, and the sweep's own diagnostics are what gets cut,
   * into the room left between the two — whole sentences while they fit, then
   * the opening of the next one, once, with the cut marked.
   */
  test("a large sweep with a long SNMP error and both notes still uploads at most 500 characters", async () => {
    const HOST_COUNT: number = 3000;
    const LONG_SNMP_ERROR: string =
      "Error: Authentication failure (incorrect password, community or key) from agent 10.20.3.7 while reading sysName.0 on udp/161";

    scanSpy.mockResolvedValue(
      makeSnmpResult(makeHosts(HOST_COUNT, 12), {
        scannedHostCount: 65534,
        respondedToPingCount: 3000,
        icmpFilteredFallbackHostCount: 62522,
        snmpErrorHostCount: 480,
        mostCommonSnmpError: LONG_SNMP_ERROR,
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 310,
      lookedUpCount: 1024,
      isTimeBudgetExhausted: true,
    });
    /*
     * The double names the first 310 addresses, which include the 12 SNMP
     * hosts: 3,000 - 310 = 2,690 still unnamed, and 690 over the cap.
     */
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 90,
      queriedCount: 1400,
      isHostCapReached: true,
      isTimeBudgetExhausted: true,
      maxHosts: 2000,
      totalBudgetInMs: 120000,
    });

    await runScan(makeScan({ isNetbiosLookupEnabled: true }));

    expect(netbiosCalls).toHaveLength(1);
    expect(netbiosCalls[0]!.ipAddresses).toHaveLength(2690);

    const body: JSONObject = finalUpload();
    expect(body["success"]).toBe(true);
    expect(uploadedDevices(body)).toHaveLength(HOST_COUNT);

    const message: string = finalStatusMessage();
    const headline: string =
      "Swept 65534 hosts: 3000 answered ICMP ping, 12 answered SNMP.";
    /*
     * "limit", not "time limit": the compact sentences drop the word the
     * sentence around them already implies, which is also what keeps every
     * compact sentence no longer than the full one it replaces.
     */
    const reverseDnsNote: string =
      "Reverse DNS hit its 3m 27s limit; 1,976 of 3,000 hosts not looked up.";
    const capNote: string =
      "NetBIOS skipped 690 hosts over its 2,000-host cap.";
    const netbiosTimeNote: string =
      "NetBIOS hit its 2m limit; 600 of 2,000 hosts not queried.";

    expect(message.indexOf(headline + " ")).toBe(0);
    expect(
      message.endsWith(`… ${reverseDnsNote} ${capNote} ${netbiosTimeNote}`),
    ).toBe(true);
    // Reverse DNS first: NetBIOS only ever asked what it left unnamed.
    expect(message.indexOf(reverseDnsNote)).toBeLessThan(
      message.indexOf(capNote),
    );
    // None of the full sentences made it: they are what did not fit.
    expect(message).not.toContain("were never looked up");
    expect(message).not.toContain("NetBIOS lookups are capped");
    expect(message).not.toContain("PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS");
    expect(message).not.toContain("PROBE_DISCOVERY_NETBIOS_MAX_HOSTS");
    // The sweep's quoted error is what gave way, not the note.
    expect(message).not.toContain(LONG_SNMP_ERROR);

    /*
     * Exact, because the clip point is arithmetic: 500 less the headline, the
     * compact note and the two spaces between the three is the room the
     * sweep's other sentences get. The ICMP-filter sentence fits there whole,
     * the SNMP-error one does not and is cut with 99 characters of room left
     * for it, which is far past the twenty a clipped opening has to keep to be
     * worth printing — so the cut lands inside the quoted error, and the
     * column is used to the last character.
     */
    expect(message).toBe(
      headline +
        " No host answered SNMP among those that replied to ICMP, so all 62522 ICMP-silent hosts " +
        "were probed over SNMP as well (ICMP is likely filtered on this network). " +
        "480 host(s) replied with an SNMP error rather than silence; " +
        "most common: Error: Authentication fai… " +
        `${reverseDnsNote} ${capNote} ${netbiosTimeNote}`,
    );
    expect(message).toHaveLength(MAX_STATUS_MESSAGE_LENGTH);
    // One cut, marked once.
    expect(message.split("…")).toHaveLength(2);
  });

  /*
   * The multi-credential shape of the same pile-up: six verbose credential
   * sets, three of which answered, beside an ICMP filter and a quoted SNMP
   * error at the scanner's 120-character cap. The sweep's sentences alone are
   * past the column before any note, so this is the last resort: the headline
   * whole, the rest fitted sentence by sentence, and the compact reverse-DNS
   * note whole at the end rather than a full note clipped mid-sentence.
   *
   * The crowded case is where fitting SENTENCE by sentence earns its keep.
   * Sixteen characters of room are left when the credential summary comes up,
   * and a single clip of the joined text would have spent them printing
   * "Answered by clip…" — the first words of a list, which says strictly less
   * than leaving the sentence out and marking the cut. So the whole sentences
   * that do fit survive intact, the one that does not is dropped whole, and
   * exactly one ellipsis says something was left out.
   */
  test("a multi-credential sweep whose body plus the full note would overflow uploads the compact note, headline and whole sentences intact", async () => {
    const SNMP_ERROR_AT_SCANNER_CAP: string =
      "Error: Authentication failure (incorrect password, community or key) from agent 10.20.3.7 while reading sysName.0 on udp";

    // The cap SubnetScanner excerpts a quoted SNMP error to.
    expect(SNMP_ERROR_AT_SCANNER_CAP).toHaveLength(120);

    scanSpy.mockResolvedValue(
      makeSnmpResult(makeHosts(1500, 12), {
        scannedHostCount: 65534,
        icmpFilteredFallbackHostCount: 64034,
        snmpErrorHostCount: 480,
        mostCommonSnmpError: SNMP_ERROR_AT_SCANNER_CAP,
        responderCountByConfigId: { c1: 5, c2: 4, c3: 3 },
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 200,
      lookedUpCount: 640,
      isTimeBudgetExhausted: true,
    });

    await runScan(
      makeScan({
        snmpConfigs: [
          "Headquarters building core distribution switches",
          "Warehouse and loading dock access layer switches",
          "Data centre row C top-of-rack switches",
          "Retail branch offices wireless controllers",
          "Out-of-band management network terminal servers",
          "Building services HVAC and power controllers",
        ].map((name: string, index: number): JSONObject => {
          return {
            id: `c${index + 1}`,
            name: name,
            snmpVersion: "V2c",
            snmpCommunityString: `community-${index + 1}`,
          };
        }),
      }),
    );

    const body: JSONObject = finalUpload();
    expect(body["success"]).toBe(true);
    expect(uploadedDevices(body)).toHaveLength(1500);

    const message: string = finalStatusMessage();
    const compactNote: string =
      "Reverse DNS hit its 1m 43s limit; 860 of 1,500 hosts not looked up.";

    expect(
      message.indexOf(
        "Swept 65534 hosts: 1500 answered ICMP ping, 12 answered SNMP. " +
          "No host answered SNMP among those that replied to ICMP",
      ),
    ).toBe(0);
    // The compact note, whole and last, after a marked cut.
    expect(message.endsWith(`… ${compactNote}`)).toBe(true);
    // Not the full note, whole or in part.
    expect(message).not.toContain("before its 1m 43s time limit");
    expect(message).not.toContain("were never looked up");
    expect(message).not.toContain("PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS");

    /*
     * The two sweep sentences that fit are uploaded WHOLE, the quoted error
     * included to its last character, and the credential summary is gone
     * rather than reduced to a sliver of itself. Exact, because both of those
     * follow from the fit and neither is a judgement call.
     */
    expect(message).toBe(
      "Swept 65534 hosts: 1500 answered ICMP ping, 12 answered SNMP. " +
        "No host answered SNMP among those that replied to ICMP, so all 64034 ICMP-silent hosts " +
        "were probed over SNMP as well (ICMP is likely filtered on this network). " +
        "480 host(s) replied with an SNMP error rather than silence; " +
        `most common: ${SNMP_ERROR_AT_SCANNER_CAP} … ${compactNote}`,
    );
    expect(message).toContain(SNMP_ERROR_AT_SCANNER_CAP);
    // Dropped whole: not "Answered by credentials: Headq…" and not a bare "A…".
    expect(message).not.toContain("Answer");
    // One cut, marked once.
    expect(message.split("…")).toHaveLength(2);
    // And it still fits, which is the whole point of giving anything up.
    expect(message.length).toBeLessThanOrEqual(MAX_STATUS_MESSAGE_LENGTH);
  });

  /*
   * The middle rung: the sweep's sentences fit, the full note does not fit
   * beside them, and the compact note does. Nothing may be clipped then, so
   * the upload is every sweep sentence whole followed by the compact note,
   * with no ellipsis anywhere.
   *
   * It is also the punctuation case. The sweep's last sentence here ends with
   * the quoted SNMP error rather than with a full stop — "most common: Error:
   * Authentication failure" — so a full stop has to be inserted before the
   * note, or the note reads as more of the quoted error.
   */
  test("a sweep whose sentences fit but whose full note does not uploads every sentence whole with the compact note, a full stop between them", async () => {
    scanSpy.mockResolvedValue(
      makeSnmpResult(makeHosts(1500, 12), {
        icmpFilteredFallbackHostCount: 2594,
        snmpErrorHostCount: 40,
        mostCommonSnmpError: "Error: Authentication failure",
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 200,
      lookedUpCount: 640,
      isTimeBudgetExhausted: true,
    });
    // Reverse DNS named the first 200: 1,300 left, 300 over a 1,000-host cap.
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 0,
      queriedCount: 1000,
      isHostCapReached: true,
      maxHosts: 1000,
    });

    await runScan(makeScan({ isNetbiosLookupEnabled: true }));

    expect(netbiosCalls).toHaveLength(1);
    expect(netbiosCalls[0]!.ipAddresses).toHaveLength(1300);

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts: 1500 answered ICMP ping, 12 answered SNMP. " +
        "No host answered SNMP among those that replied to ICMP, so all 2594 ICMP-silent hosts " +
        "were probed over SNMP as well (ICMP is likely filtered on this network). " +
        "40 host(s) replied with an SNMP error rather than silence; most common: Error: Authentication failure. " +
        "Reverse DNS hit its 1m 43s limit; 860 of 1,500 hosts not looked up. " +
        "NetBIOS skipped 300 hosts over its 1,000-host cap.",
    );
    expect(message).not.toContain("…");
    // The note is its own sentence, not a continuation of the quoted error.
    expect(message).not.toContain("failure Reverse DNS");
  });

  /*
   * The same punctuation, on the rung above: the FULL note fits here, so this
   * is the path most scans that say anything at all take. The sweep's last
   * sentence still ends with the quoted error and still needs a full stop
   * before the note.
   */
  test("a sweep whose last sentence is a quoted SNMP error gets a full stop before the full note", async () => {
    scanSpy.mockResolvedValue(
      makeSnmpResult(makeHosts(300, 12), {
        snmpErrorHostCount: 40,
        mostCommonSnmpError: "Error: Authentication failure",
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 25,
      lookedUpCount: 128,
      isTimeBudgetExhausted: true,
    });

    await runScan(makeScan());

    const message: string = finalStatusMessage();
    expect(message).toBe(
      "Swept 4094 hosts: 300 answered ICMP ping, 12 answered SNMP. " +
        "40 host(s) replied with an SNMP error rather than silence; most common: Error: Authentication failure. " +
        "Reverse DNS named 25 of 300 hosts before its 1m time limit; 172 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
    expect(message).not.toContain("failure Reverse DNS");
    // One full stop, not two: the error's own text carries none to double.
    expect(message).not.toContain("failure..");
  });

  /*
   * And the guard on that: the full stop belongs to the JOIN, not to the
   * sweep's summary. With nothing to confess there is no note to introduce,
   * and the message has to stay byte for byte what it was before the naming
   * note existed — quoted error at the end, unpunctuated.
   */
  test("the same sweep with nothing to confess uploads its quoted error unpunctuated", async () => {
    scanSpy.mockResolvedValue(
      makeSnmpResult(makeHosts(300, 12), {
        snmpErrorHostCount: 40,
        mostCommonSnmpError: "Error: Authentication failure",
      }) as never,
    );
    mockReverseDnsPass({ namedCount: 25, lookedUpCount: 300 });

    await runScan(makeScan());

    expect(finalStatusMessage()).toBe(
      "Swept 4094 hosts: 300 answered ICMP ping, 12 answered SNMP. " +
        "40 host(s) replied with an SNMP error rather than silence; most common: Error: Authentication failure",
    );
  });

  test("an ICMP-only sweep that stopped early, with both notes, still fits", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(3000), {
        scannedHostCount: 65534,
        isIcmpSweepIncomplete: true,
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 310,
      lookedUpCount: 1024,
      isTimeBudgetExhausted: true,
    });
    mockNetbiosPass({
      namedCount: 90,
      queriedCount: 1400,
      isHostCapReached: true,
      isTimeBudgetExhausted: true,
      maxHosts: 2000,
      totalBudgetInMs: 120000,
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    /*
     * The caveat and the headline are both ESSENTIAL on this path: the count
     * of hosts that answered is unreadable without the caveat that the sweep
     * stopped. The full notes (343 characters) cannot fit beside them, the
     * compact ones can, so the upload is all three whole and nothing clipped.
     */
    const message: string = finalStatusMessage();
    expect(message).toBe(
      INCOMPLETE_ICMP_SWEEP_CAVEAT +
        " Swept 65534 hosts with ICMP ping only (Check SNMP is off for this scan): 3000 answered ping. " +
        "Reverse DNS hit its 3m 27s limit; 1,976 of 3,000 hosts not looked up. " +
        "NetBIOS skipped 690 hosts over its 2,000-host cap. " +
        "NetBIOS hit its 2m limit; 600 of 2,000 hosts not queried.",
    );
    expect(message).not.toContain("…");
    /*
     * The compact cap sentence carries no advice. The knob is named in the
     * FULL sentence, which is the one an operator reads when there is room
     * for it; a compact note is already the message giving things up.
     */
    expect(message).not.toContain("PROBE_DISCOVERY_NETBIOS_MAX_HOSTS");
  });

  /*
   * The same essential pair under the longest compact note this path
   * realistically carries: both passes failing with reasons far longer than
   * a compact sentence quotes, beside the NetBIOS cap. Every reason is cut to
   * forty characters (ellipsis included) and its trailing period dropped, so
   * the note stays whole and the caveat and the "answered ping" headline
   * still lead the message untouched.
   */
  test("an ICMP-only sweep that stopped early keeps its caveat and headline whole beside long failure reasons on both notes", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult(makeHosts(3000), {
        scannedHostCount: 65534,
        isIcmpSweepIncomplete: true,
      }) as never,
    );
    mockReverseDnsPass({
      namedCount: 0,
      lookedUpCount: 64,
      isReverseDnsAvailable: false,
      failureReason:
        "queryPtr ETIMEOUT 10.20.0.1 after 2000ms waiting on resolver 10.20.255.53:53.",
    });
    // Reverse DNS named nobody: all 3,000 go to NetBIOS, 1,000 over the cap.
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 20,
      queriedCount: 700,
      isHostCapReached: true,
      isTimeBudgetExhausted: true,
      maxHosts: 2000,
      failureReason:
        "send EHOSTUNREACH 10.20.2.201:137 because no route to host exists.",
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(netbiosCalls).toHaveLength(1);
    expect(netbiosCalls[0]!.ipAddresses).toHaveLength(3000);

    const essential: string =
      INCOMPLETE_ICMP_SWEEP_CAVEAT +
      " Swept 65534 hosts with ICMP ping only (Check SNMP is off for this scan): 3000 answered ping.";
    const message: string = finalStatusMessage();

    expect(message.indexOf(essential + " ")).toBe(0);
    expect(message).toBe(
      essential +
        " Reverse DNS got no answers (queryPtr ETIMEOUT 10.20.0.1 after 2000m…)." +
        " NetBIOS skipped 1,000 hosts over its 2,000-host cap." +
        " NetBIOS socket failed (send EHOSTUNREACH 10.20.2.201:137 becau…).",
    );
    // The socket's reason still beats the time budget it also reported.
    expect(message).not.toContain("time limit");
  });
});

describe("runScan — a sweep that fails never reaches naming", () => {
  /*
   * The naming passes run only after the sweep has WON its deadline race. A
   * wedged sweep is abandoned at the deadline, so neither pass may be asked —
   * each would be hundreds of lookups on behalf of a result that is being
   * thrown away — and the failure report must say the sweep did not finish,
   * not describe a naming pass that never happened.
   *
   * This sweep reports progress first and then never settles, which is how a
   * wedged sweep really looks from runScan: hosts already on the server, and
   * no final result.
   */
  test("a sweep that misses its deadline uploads success:false with no naming note, and naming is never asked", async () => {
    const hosts: Array<DiscoveredHost> = makeHosts(300);

    scanSpy.mockImplementation(
      (config: SubnetScanConfig): Promise<SubnetScanResult> => {
        void config.onProgress?.({
          sweptHostCount: 512,
          totalHostCount: 4094,
          discoveredHosts: hosts.map((host: DiscoveredHost) => {
            return { ...host };
          }),
          snmpResponderCount: 0,
          respondedToPingCount: hosts.length,
          isIcmpOnlySweep: true,
        });

        return new Promise<SubnetScanResult>(() => {
          // Never settles, exactly as a wedged ping/SNMP promise behaves.
        });
      },
    );
    const reverseDnsCalls: Array<ReverseDnsPassCall> = mockReverseDnsPass({
      namedCount: 25,
      lookedUpCount: 128,
      isTimeBudgetExhausted: true,
    });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 0,
      queriedCount: 0,
      isHostCapReached: true,
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(reverseDnsCalls).toEqual([]);
    expect(netbiosCalls).toEqual([]);

    const uploads: Array<JSONObject> = resultUploads();
    const failure: JSONObject = uploads[uploads.length - 1]!;
    const failureMessage: string = failure["statusMessage"] as string;

    expect(failure["success"]).toBe(false);
    expect(failure["isPartial"]).toBeUndefined();
    expect(failureMessage).toContain("did not finish");
    expect(failureMessage).not.toContain("Reverse DNS");
    expect(failureMessage).not.toContain("NetBIOS");
    // No host list: the hosts already uploaded as progress must stand.
    expect(failure).not.toHaveProperty("discoveredDevices");

    // And the progress upload that preceded it carried no note either.
    for (const partial of uploads.slice(0, -1)) {
      expect(partial["isPartial"]).toBe(true);
      expect(partial["statusMessage"] as string).not.toContain("Reverse DNS");
    }
  });

  test("a sweep that throws uploads its own reason, with no naming note, and naming is never asked", async () => {
    scanSpy.mockRejectedValue(
      new Error(
        "ICMP ping is not usable: ping: socket: Operation not permitted",
      ) as never,
    );
    const reverseDnsCalls: Array<ReverseDnsPassCall> = mockReverseDnsPass({
      namedCount: 0,
      lookedUpCount: 0,
      isReverseDnsAvailable: false,
    });
    const netbiosCalls: Array<NetbiosPassCall> = mockNetbiosPass({
      namedCount: 0,
      queriedCount: 0,
      failureReason: "bind EACCES",
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(reverseDnsCalls).toEqual([]);
    expect(netbiosCalls).toEqual([]);

    const uploads: Array<JSONObject> = resultUploads();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!["success"]).toBe(false);
    expect(uploads[0]!["statusMessage"]).toBe(
      "ICMP ping is not usable: ping: socket: Operation not permitted",
    );
  });
});
