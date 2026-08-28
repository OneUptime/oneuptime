// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner, {
  DiscoveredHost,
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * github.com/OneUptime/oneuptime/issues/3445 — "SNMP Version is marked
 * required even when performing an ICMP-only scan".
 *
 * A discovery scan used to be an SNMP scan, full stop, and the wizard's
 * required SNMP Version field made that non-negotiable: an operator who only
 * wanted to know what was alive in 10.20.30.0/24 could not submit the form at
 * all. `isSnmpEnabled` is the missing sentence, and this suite pins what the
 * SWEEP does once it is false.
 *
 * Two invariants matter more than the rest, and both are asserted repeatedly
 * below rather than once:
 *
 *   1. An ICMP-only sweep must send NO SNMP. The operator said "do not touch
 *      these hosts with SNMP"; an unauthenticated v2c/public sweep of a
 *      customer subnet cannot be undone after the fact. Phase 3 of scan() —
 *      the ICMP-filtered fallback — is the live hazard here, because its
 *      trigger is `snmpResponderCount === 0`, and that is STRUCTURALLY true on
 *      every ICMP-only sweep. It is gated on isSnmpEnabled for exactly that
 *      reason, and these tests hold the gate shut.
 *
 *   2. An ABSENT isSnmpEnabled means SNMP. A config assembled without the
 *      field describes the sweep this probe ran before the column existed —
 *      a probe upgraded ahead of its server sees exactly that. Reading the
 *      absence as "off" would silently turn every scan in a project into a
 *      ping sweep, which is a data-loss-shaped bug that no error message would
 *      ever announce.
 *
 * The ping layer is never really exercised: isHostAliveByPing is spied on the
 * same way SubnetScanner.test.ts and SubnetScannerIcmpFallback.test.ts do it,
 * so no test here forks the OS ping binary or needs ICMP privileges.
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
 * Records every host handed to the SNMP layer, answering for the hosts in
 * `snmpSpeakers` and staying silent for the rest. The push is the FIRST
 * statement of the mock, so an empty `hosts` array is proof the spy was never
 * called — which is the security-relevant assertion in this file.
 *
 * It is also the ONLY thing that tells the two modes apart in most of the
 * assertions below, and that is not a stylistic point. Against a SILENT
 * SnmpMonitor the SNMP path returns a result byte-identical to the ICMP-only
 * one — same hosts, same `snmpReachable: false` on every record, same tallies
 * — so a test that inspects only the returned value stays green on a build
 * that pings AND SNMP-sweeps every address, which is precisely the behaviour
 * the operator switched off. `recorder.hosts` is what makes the difference
 * observable, so nearly every test below asserts it is empty even when the
 * sentence in its name is about something else.
 */
type ProbeRecorder = {
  hosts: Array<string>;
};

function recordSnmpProbes(snmpSpeakers: Array<string> = []): ProbeRecorder {
  const recorder: ProbeRecorder = { hosts: [] };

  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      recorder.hosts.push(config.hostname || "");

      if (snmpSpeakers.includes(config.hostname || "")) {
        return { sysName: `device-${config.hostname}` };
      }

      return null;
    });

  return recorder;
}

/*
 * Answers the ICMP pre-sweep for `aliveHosts` and reports every other address
 * as cleanly down. Returns the list of addresses actually pinged, so a test
 * can assert the sweep covered the whole target — on an ICMP-only scan the
 * ping IS the probe, so an address that was never pinged was never scanned.
 */
function mockPingAlive(aliveHosts: Array<string>): Array<string> {
  const pinged: Array<string> = [];

  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      pinged.push(host);
      return aliveHosts.includes(host);
    });

  return pinged;
}

/*
 * Pinging itself is broken for every address — no ICMP privileges, or no ping
 * binary. isHostAliveByPing REJECTS in that case (a host that is merely down
 * resolves false), which is the distinction the whole ICMP-only failure path
 * turns on.
 */
function mockPingUnusable(
  reason: string = "ICMP ping is not usable: ping: socket: Operation not permitted",
): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockRejectedValue(new Error(reason));
}

function discoveredAddresses(result: SubnetScanResult): Array<string> {
  return result.discoveredHosts.map((host: DiscoveredHost) => {
    return host.ipAddress;
  });
}

async function captureScanError(target: string): Promise<Error> {
  try {
    await SubnetScanner.scan({ cidr: target, isSnmpEnabled: false });
  } catch (err) {
    return err as Error;
  }

  throw new Error(`Expected the sweep of ${target} to throw, but it resolved.`);
}

/*
 * The pre-sweep's failure log is the only place the two modes announce
 * themselves at the moment ping breaks, and it is silenced here as well as
 * captured: without the stub every mockPingUnusable test prints a warning per
 * concurrent worker.
 */
// eslint-disable-next-line @typescript-eslint/typedef
let warnSpy = jest.spyOn(logger, "warn");

function loggedWarnings(): string {
  return warnSpy.mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
}

beforeEach(() => {
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    // Keep the test output readable.
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SubnetScanner — an ICMP-only sweep sends no SNMP", () => {
  /*
   * The promise the toggle makes. Every other assertion in this file is
   * downstream of this one: the operator turned SNMP off, so not one UDP/161
   * datagram may leave the probe, for any address, in any phase.
   */
  it("never asks a single host for its SNMP system group", async () => {
    mockPingAlive(["10.0.0.2", "10.0.0.5"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    await SubnetScanner.scan({ cidr: SIX_HOSTS, isSnmpEnabled: false });

    expect(recorder.hosts).toEqual([]);
  });

  it("sends no SNMP even for the hosts that answered ping", async () => {
    // Every address is alive: the SNMP path would have probed all six.
    mockPingAlive(ALL_SIX);
    const recorder: ProbeRecorder = recordSnmpProbes();

    await SubnetScanner.scan({ cidr: SIX_HOSTS, isSnmpEnabled: false });

    expect(recorder.hosts).toEqual([]);
  });

  /*
   * Phase 3 re-probes every ICMP-silent address over SNMP when the gated pass
   * produced no SNMP responder — with community "public" over v2c, because
   * probeHost defaults both. Its trigger, `snmpResponderCount === 0`, is
   * structurally true on an ICMP-only sweep (nothing ever increments it), so
   * without the isSnmpEnabled gate a scan that asked for no SNMP would end in
   * an unauthenticated sweep of the whole customer subnet.
   *
   * Asserted two ways deliberately: the spy was never called, AND the counter
   * the fallback increments stayed at zero. Either one alone could be made to
   * pass by a change that broke the other.
   */
  it("does not run the ICMP-filtered fallback even though no host answered SNMP", async () => {
    mockPingAlive([]);
    const recorder: ProbeRecorder = recordSnmpProbes(ALL_SIX);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(recorder.hosts).toEqual([]);
    expect(result.icmpFilteredFallbackHostCount).toBe(0);
    expect(result.discoveredHosts).toEqual([]);
  });

  /*
   * A row switched from SNMP to ping-only keeps whatever SNMP config it was
   * created with (the columns are only cleared on create). Those values must
   * be inert, not a back door into the SNMP path.
   */
  it("ignores the SNMP credentials a legacy row still carries", async () => {
    const v3Auth: SnmpV3Auth = {
      securityLevel: SnmpSecurityLevel.AuthPriv,
      username: "monitoring",
      authProtocol: SnmpAuthProtocol.SHA,
      authKey: "auth-passphrase",
    } as SnmpV3Auth;

    mockPingAlive(["10.0.0.3"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
      snmpVersion: "V3",
      snmpV3Auth: v3Auth,
      snmpCommunityString: "private",
      snmpPort: 1610,
    });

    expect(recorder.hosts).toEqual([]);
    expect(result.isIcmpOnlySweep).toBe(true);
  });

  it("still pings every address in the target — the ping is the probe", async () => {
    const pinged: Array<string> = mockPingAlive(["10.0.0.1"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    await SubnetScanner.scan({ cidr: SIX_HOSTS, isSnmpEnabled: false });

    expect([...pinged].sort()).toEqual(ALL_SIX);
    // The whole target was pinged, and that is ALL that was sent to it.
    expect(recorder.hosts).toEqual([]);
  });
});

describe("SubnetScanner — what an ICMP-only sweep returns", () => {
  /*
   * snmpReachable FALSE, never undefined.
   *
   * The flag is what DiscoveryImportEligibility reads to route a host to the
   * Monitor monitoring method on import: false means "asked for SNMP, got
   * nothing", which is exactly the position an ICMP-only host is in from the
   * importer's point of view — no system group, no vendor OID, no credentials.
   * Undefined would read as a legacy SNMP responder and import an SNMP-polled
   * device that could never be polled, so the value is asserted structurally
   * (toEqual on the whole object) rather than with a truthiness check that
   * `undefined` would also satisfy.
   *
   * The recorder assertion is not decoration. This exact host list, with these
   * exact flags, is ALSO what the SNMP path returns when no host answers SNMP,
   * so the returned value alone cannot say which mode ran — only the silent
   * SNMP spy can.
   */
  it("returns every ping-alive host with snmpReachable false, and asks none of them for SNMP", async () => {
    mockPingAlive(["10.0.0.2", "10.0.0.5"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.2", snmpReachable: false },
      { ipAddress: "10.0.0.5", snmpReachable: false },
    ]);
    expect(recorder.hosts).toEqual([]);
  });

  it("records snmpReachable as the boolean false, not as an absent key", async () => {
    mockPingAlive(["10.0.0.4"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    const host: DiscoveredHost = result.discoveredHosts[0]!;
    expect(host.snmpReachable).toBe(false);
    /*
     * There is no system group because nothing was asked for one — asserted
     * together with the empty recorder, so "sysName is undefined" cannot be
     * satisfied by a build that DID ask and got silence back.
     */
    expect(recorder.hosts).toEqual([]);
    expect(host.sysName).toBeUndefined();
    expect(host.sysDescr).toBeUndefined();
    expect(host.sysObjectId).toBeUndefined();
  });

  it("leaves out the hosts that did not answer ping", async () => {
    mockPingAlive(["10.0.0.3"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(discoveredAddresses(result)).toEqual(["10.0.0.3"]);
    for (const silentHost of ["10.0.0.1", "10.0.0.2", "10.0.0.4"]) {
      expect(discoveredAddresses(result)).not.toContain(silentHost);
    }
    // Left out of the result, and never contacted over SNMP either.
    expect(recorder.hosts).toEqual([]);
  });

  it("returns an empty host list for a range where nothing answered", async () => {
    mockPingAlive([]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(result.discoveredHosts).toEqual([]);
    expect(result.respondedToPingCount).toBe(0);
    /*
     * An empty range is the state that ARMS the phase-3 fallback on the SNMP
     * path (nothing answered ping, so nothing answered SNMP), so this is the
     * fixture where an ungated build would sweep all six addresses.
     */
    expect(recorder.hosts).toEqual([]);
  });

  /*
   * The ICMP-only path returns hosts filtered straight out of expandTarget
   * rather than sorting a list built in completion order, so the ordering is
   * a property of the filter and would break silently if that ever became a
   * Set iteration or a push-as-they-answer loop.
   */
  it("returns the hosts in ascending address order", async () => {
    // Deliberately named out of order, and answering out of order.
    mockPingAlive(["10.0.0.6", "10.0.0.1", "10.0.0.4"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(discoveredAddresses(result)).toEqual([
      "10.0.0.1",
      "10.0.0.4",
      "10.0.0.6",
    ]);
    expect(recorder.hosts).toEqual([]);
  });

  it("orders across octet boundaries, not lexically", async () => {
    /*
     * "10.0.0.10" sorts before "10.0.0.9" as a string. The range notation is
     * expanded numerically, so the result must be numeric too.
     */
    mockPingAlive(["10.0.0.10", "10.0.0.9", "10.0.0.2"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.0.0.1-20",
      isSnmpEnabled: false,
    });

    expect(discoveredAddresses(result)).toEqual([
      "10.0.0.2",
      "10.0.0.9",
      "10.0.0.10",
    ]);
    expect(recorder.hosts).toEqual([]);
  });

  it("counts the whole target as scanned and only the answers as alive", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    // Six addresses were swept; two of them answered.
    expect(result.scannedHostCount).toBe(6);
    expect(result.respondedToPingCount).toBe(2);
    // "Swept" means pinged. Nothing here was probed over SNMP.
    expect(recorder.hosts).toEqual([]);
  });

  /*
   * scannedPort feeds the "Nothing answered SNMP on port N. Check that UDP/N
   * is permitted" advice. An ICMP-only sweep dials no port at all, so naming
   * 161 there would send the operator to a firewall rule for traffic the probe
   * never sent — undefined is the only honest answer.
   */
  it("reports no scanned port, because no port was dialled", async () => {
    mockPingAlive(ALL_SIX);
    recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(result.scannedPort).toBeUndefined();
  });

  it("reports no scanned port even when the row configures a custom one", async () => {
    mockPingAlive(ALL_SIX);
    recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
      snmpPort: 1610,
    });

    expect(result.scannedPort).toBeUndefined();
  });

  /*
   * Zero because nothing was asked, not zero because everything answered
   * cleanly. The status message has to tell those two zeroes apart, and it
   * does so through isIcmpOnlySweep — so these must not carry a stray value
   * that a future reader could mistake for a finding.
   */
  it("reports no SNMP errors and no most-common SNMP error", async () => {
    mockPingAlive(["10.0.0.1"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    /*
     * Zero because nothing was asked. The recorder is what says so: a sweep
     * that DID probe every host over SNMP and got silence reports the same two
     * values, and that is the reading this pair has to rule out.
     */
    expect(recorder.hosts).toEqual([]);
    expect(result.snmpErrorHostCount).toBe(0);
    expect(result.mostCommonSnmpError).toBeUndefined();
  });

  it("flags the sweep as ICMP-only and as complete", async () => {
    mockPingAlive(["10.0.0.1"]);
    recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(result.isIcmpOnlySweep).toBe(true);
    // A clean sweep covered the whole range: no "stopped early" caveat.
    expect(result.isIcmpSweepIncomplete).toBe(false);
  });

  it("sweeps a single bare address", async () => {
    mockPingAlive(["10.9.8.7"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.9.8.7",
      isSnmpEnabled: false,
    });

    expect(result.scannedHostCount).toBe(1);
    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.9.8.7", snmpReachable: false },
    ]);
    expect(recorder.hosts).toEqual([]);
  });

  it("sweeps an octet-range target the same way it sweeps a CIDR", async () => {
    mockPingAlive(["10.1.0.6", "10.2.0.5"]);
    recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.1-2.0.5-6",
      isSnmpEnabled: false,
    });

    expect(result.scannedHostCount).toBe(4);
    expect(discoveredAddresses(result)).toEqual(["10.1.0.6", "10.2.0.5"]);
    expect(result.isIcmpOnlySweep).toBe(true);
  });

  /*
   * Sweeping a whole subnet at once forks a ping process per address and
   * exhausts sockets. The ICMP-only path leans on the same phase-1 wave the
   * SNMP path does, so the limit has to hold when the ping is the only work
   * being done.
   */
  it("keeps the ping sweep inside the concurrency limit", async () => {
    const inFlight: { now: number; peak: number } = { now: 0, peak: 0 };

    const recorder: ProbeRecorder = recordSnmpProbes();
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async () => {
        inFlight.now++;
        inFlight.peak = Math.max(inFlight.peak, inFlight.now);
        await new Promise((resolve: (value: void) => void) => {
          setTimeout(resolve, 1);
        });
        inFlight.now--;
        return false;
      });

    // 126 hosts, well past the 32-worker wave size.
    await SubnetScanner.scan({ cidr: "10.0.0.0/25", isSnmpEnabled: false });

    expect(inFlight.peak).toBeGreaterThan(1);
    expect(inFlight.peak).toBeLessThanOrEqual(32);
    // And the ping wave was the only wave: no SNMP wave followed it.
    expect(recorder.hosts).toEqual([]);
  });
});

describe("SubnetScanner — an ICMP-only sweep with no usable ping", () => {
  /*
   * The SNMP sweep treats a broken pre-sweep as an optimisation that failed:
   * it falls back to SNMP-probing every host. An ICMP-only sweep has nothing
   * to fall back TO, so the same failure is fatal.
   *
   * Reporting "0 of 254 answered" for a probe that never sent one echo request
   * would read as "this subnet is empty", and the single fact that explains it
   * — this container cannot open an ICMP socket — would live only in a probe
   * log the operator cannot see. That is the exact false negative the
   * pre-sweep's own privilege detection was added to prevent.
   */
  it("throws rather than reporting an empty subnet", async () => {
    mockPingUnusable();
    recordSnmpProbes();

    await expect(
      SubnetScanner.scan({ cidr: SIX_HOSTS, isSnmpEnabled: false }),
    ).rejects.toThrow(/could not send ICMP echo requests/);
  });

  /*
   * Both halves of what an operator has to check, named in the message itself:
   * the probe needs a ping binary AND the capability to open a raw socket, and
   * either one can be the missing piece (a stripped custom image, or a hardened
   * runtime that drops capabilities). A message naming only one of them sends
   * half of these reports to support.
   */
  it("names both the ping binary and NET_RAW, so the operator can act on the message without a support ticket", async () => {
    mockPingUnusable();
    recordSnmpProbes();

    const error: Error = await captureScanError(SIX_HOSTS);

    expect(error.message).toContain("NET_RAW");
    expect(error.message).toContain("ping binary");
  });

  it("offers Check SNMP as the other way out", async () => {
    mockPingUnusable();
    recordSnmpProbes();

    const error: Error = await captureScanError(SIX_HOSTS);

    expect(error.message).toContain("Check SNMP on");
  });

  it("quotes what the ping layer actually reported", async () => {
    mockPingUnusable(
      "ICMP ping is not usable: ping: socket: Operation not permitted",
    );
    recordSnmpProbes();

    const error: Error = await captureScanError(SIX_HOSTS);

    expect(error.message).toContain("Ping reported:");
    expect(error.message).toContain("Operation not permitted");
  });

  /*
   * The failure reason is quoted into statusMessage, a varchar(500). The OS
   * ping's stderr is untrimmed and often multi-line, so the excerpt is capped
   * at the same 120 characters an SNMP error is capped at.
   *
   * The cap is NOT what keeps this message inside the column — the fixed prose
   * is 435 characters on its own, so the full message is 555 and the ingest
   * endpoint clips it (substring(0, 500),
   * App/FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan.ts). What the cap
   * and the ordering buy together is that the clip can only ever eat the tail
   * of the QUOTED STDERR: the diagnosis and both fixes sit ahead of "Ping
   * reported:", so they survive however much the ping binary wrote.
   */
  it("keeps only the head of an enormous ping error, and keeps the advice ahead of it", async () => {
    mockPingUnusable("P".repeat(5000));
    recordSnmpProbes();

    const error: Error = await captureScanError(SIX_HOSTS);

    const quotedReason: string = error.message.split("Ping reported: ")[1]!;
    expect(quotedReason).toHaveLength(120);

    const clipped: string = error.message.substring(0, 500);
    expect(clipped).toContain("could not send ICMP echo requests");
    expect(clipped).toContain("NET_RAW");
    expect(clipped).toContain("Check SNMP on");
    // The stderr is last, so it is the only thing the clip can cost.
    expect(error.message.indexOf("Ping reported:")).toBeGreaterThan(
      error.message.indexOf("NET_RAW"),
    );
  });

  /*
   * The cap on the boundary rather than five kilobytes past it: an off-by-one
   * that cut at 119 would silently shorten every quoted reason, and one that
   * cut at 121 is the same defect in the other direction. String(err) prefixes
   * "Error: ", so the seven characters are budgeted for below.
   */
  it("cuts the quoted reason at exactly 120 characters, and not one earlier", async () => {
    mockPingUnusable("A".repeat(112)); // 119 characters once stringified.
    recordSnmpProbes();

    const shortError: Error = await captureScanError(SIX_HOSTS);

    expect(shortError.message.split("Ping reported: ")[1]).toHaveLength(119);

    mockPingUnusable("B".repeat(114)); // 121 characters once stringified.

    const longError: Error = await captureScanError(SIX_HOSTS);

    expect(longError.message.split("Ping reported: ")[1]).toHaveLength(120);
  });

  /*
   * The pre-sweep's warning is written at the moment ping breaks, before the
   * mode is visible anywhere else in the log, and it is the only line an
   * operator reading probe logs will see for a scan that then fails. It has to
   * say which of the two things happens next — a fallback, or a failed scan —
   * because the SNMP wording ("Falling back to SNMP-probing every host") is a
   * flat lie on a scan that is about to throw.
   */
  it("warns that this mode has nothing to fall back to", async () => {
    mockPingUnusable();
    recordSnmpProbes();

    await captureScanError(SIX_HOSTS);

    const warnings: string = loggedWarnings();
    expect(warnings).toContain("Discovery ICMP pre-sweep unavailable");
    expect(warnings).toContain("nothing to fall back to");
    expect(warnings).toContain("will be reported as failed");
    expect(warnings).not.toContain("Falling back to SNMP-probing every host");
  });

  it("says 'unknown error' rather than an empty sentence when the failure carried no text", async () => {
    /*
     * String(err) is what gets quoted, so a failure whose string form is empty
     * leaves the reason blank. The message must still end in something the
     * operator can read.
     */
    class SilentPingFailure extends Error {
      public override toString(): string {
        return "";
      }
    }

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockRejectedValue(new SilentPingFailure("no text"));
    recordSnmpProbes();

    const error: Error = await captureScanError(SIX_HOSTS);

    expect(error.message).toContain("Ping reported: unknown error");
  });

  it("sends no SNMP on its way out", async () => {
    mockPingUnusable();
    const recorder: ProbeRecorder = recordSnmpProbes(ALL_SIX);

    await captureScanError(SIX_HOSTS);

    /*
     * The throw happens before phase 2 exists. A regression that moved the
     * guard below the SNMP probe would still throw, and would still pass a
     * rejects.toThrow assertion, while having swept the subnet over SNMP
     * first.
     */
    expect(recorder.hosts).toEqual([]);
  });

  // The SNMP sweep is unaffected: a broken pre-sweep there is still survivable.
  it("does not throw for the same broken ping when SNMP is on", async () => {
    mockPingUnusable();
    const recorder: ProbeRecorder = recordSnmpProbes([]);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
    });

    expect(recorder.hosts).toHaveLength(6);
    expect(result.respondedToPingCount).toBeUndefined();
  });

  it("and the same broken ping warns about the SNMP fallback instead", async () => {
    mockPingUnusable();
    recordSnmpProbes([]);

    await SubnetScanner.scan({ cidr: SIX_HOSTS });

    const warnings: string = loggedWarnings();
    expect(warnings).toContain("Falling back to SNMP-probing every host");
    expect(warnings).not.toContain("will be reported as failed");
  });
});

describe("SubnetScanner — an ICMP-only sweep whose ping broke partway", () => {
  /*
   * Hosts confirmed before the ping layer died are real findings, and throwing
   * them away because the sweep could not finish would be its own false
   * negative. They are reported, with a flag saying the range is not fully
   * covered — a partial tally must never read as the whole subnet.
   */
  function mockPingBreakingAfter(aliveHosts: Array<string>): void {
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        if (aliveHosts.includes(host)) {
          return true;
        }
        throw new Error("ping binary vanished mid-scan");
      });
  }

  it("returns the confirmed hosts instead of throwing", async () => {
    mockPingBreakingAfter(["10.0.0.1", "10.0.0.2"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.2", snmpReachable: false },
    ]);
    /*
     * A broken pre-sweep is exactly the state that makes the SNMP path probe
     * EVERY address in the range rather than the ping-alive subset, so this is
     * the fixture where losing the mode is loudest — and the host list alone
     * would not show it.
     */
    expect(recorder.hosts).toEqual([]);
  });

  it("flags the sweep as incomplete", async () => {
    mockPingBreakingAfter(["10.0.0.1"]);
    recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(result.isIcmpOnlySweep).toBe(true);
    expect(result.isIcmpSweepIncomplete).toBe(true);
  });

  /*
   * Unlike the SNMP path, which reports respondedToPingCount as undefined when
   * the pre-sweep only half ran, the ICMP-only path reports the partial count
   * — it is the result, not a gate — and pairs it with the incomplete flag so
   * the status message can caveat it.
   */
  it("reports the partial count alongside the full target size", async () => {
    mockPingBreakingAfter(["10.0.0.1", "10.0.0.2"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(result.respondedToPingCount).toBe(2);
    expect(result.scannedHostCount).toBe(6);
    /*
     * The SNMP path reports respondedToPingCount as UNDEFINED once the
     * pre-sweep breaks; a defined 2 here is already mode-specific, and the
     * empty recorder says why.
     */
    expect(recorder.hosts).toEqual([]);
  });

  it("still sends no SNMP", async () => {
    mockPingBreakingAfter(["10.0.0.1"]);
    const recorder: ProbeRecorder = recordSnmpProbes(ALL_SIX);

    await SubnetScanner.scan({ cidr: SIX_HOSTS, isSnmpEnabled: false });

    expect(recorder.hosts).toEqual([]);
  });

  it("still returns the confirmed hosts in ascending order", async () => {
    mockPingBreakingAfter(["10.0.0.5", "10.0.0.2"]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    expect(discoveredAddresses(result)).toEqual(["10.0.0.2", "10.0.0.5"]);
    expect(recorder.hosts).toEqual([]);
  });
});

describe("SubnetScanner — target validation still runs first", () => {
  /*
   * The target is validated before anything is expanded or probed, and turning
   * SNMP off must not move that. A malformed target that reached the ping
   * phase would fork a ping per garbage address before failing.
   */
  it("rejects a malformed target without pinging anything", async () => {
    const pinged: Array<string> = mockPingAlive([]);
    const recorder: ProbeRecorder = recordSnmpProbes();

    await expect(
      SubnetScanner.scan({ cidr: "not-a-cidr", isSnmpEnabled: false }),
    ).rejects.toThrow(/not a valid scan target/);

    expect(pinged).toEqual([]);
    expect(recorder.hosts).toEqual([]);
  });

  it("rejects an oversized target before expanding it", async () => {
    const pinged: Array<string> = mockPingAlive([]);
    recordSnmpProbes();

    await expect(
      SubnetScanner.scan({ cidr: "10.0.0.0/8", isSnmpEnabled: false }),
    ).rejects.toThrow(/exceeding the/);

    expect(pinged).toEqual([]);
  });

  it("rejects an empty target", async () => {
    mockPingAlive([]);
    recordSnmpProbes();

    await expect(
      SubnetScanner.scan({ cidr: "", isSnmpEnabled: false }),
    ).rejects.toThrow(/scan target is required/);
  });

  it("rejects a reversed octet range rather than sweeping nothing", async () => {
    mockPingAlive([]);
    recordSnmpProbes();

    await expect(
      SubnetScanner.scan({ cidr: "10.22-16.0.1-20", isSnmpEnabled: false }),
    ).rejects.toThrow(/reversed/);
  });

  /*
   * Defensive: a target that passes validation but expands to nothing would
   * otherwise produce a sweep of zero addresses reported as a clean success —
   * "Completed, 0 of 0" — which is the least debuggable outcome available.
   * Forced here, because no target reachable through the validator produces
   * it today; the guard exists so that a future parser change cannot make it
   * reachable silently.
   */
  it("rejects a target that expands to no addresses", async () => {
    jest.spyOn(SubnetScanner, "expandTarget").mockReturnValue([]);
    const pinged: Array<string> = mockPingAlive([]);
    recordSnmpProbes();

    await expect(
      SubnetScanner.scan({ cidr: SIX_HOSTS, isSnmpEnabled: false }),
    ).rejects.toThrow(/expands to no addresses/);

    expect(pinged).toEqual([]);
  });
});

/*
 * THE INVARIANT THIS WHOLE CHANGE RESTS ON.
 *
 * Only an EXPLICIT false turns SNMP off. A config with the field missing, or
 * carrying null because it came off a JSON payload from a server too old to
 * select the column, describes the sweep this probe ran before ICMP-only scans
 * existed — and that sweep did SNMP.
 *
 * A regression here does not throw and does not log: it just stops doing SNMP
 * discovery for every scan in the project, and every one of those scans still
 * reports "Completed".
 */
describe("SubnetScanner — an absent isSnmpEnabled means SNMP", () => {
  it("probes SNMP when the field is not set at all", async () => {
    mockPingAlive(ALL_SIX);
    const recorder: ProbeRecorder = recordSnmpProbes(["10.0.0.4"]);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
    });

    expect([...recorder.hosts].sort()).toEqual(ALL_SIX);
    /*
     * ABSENT, not false. The SNMP return literal sets no flag at all, and the
     * readers (buildScanStatusMessage, ScanModeUtil) are written against that
     * absence — toBeFalsy() would also accept a stray false, 0 or "".
     */
    expect(result.isIcmpOnlySweep).toBeUndefined();
    expect(result.scannedPort).toBe(161);
  });

  it("probes SNMP when the field is explicitly undefined", async () => {
    mockPingAlive(ALL_SIX);
    const recorder: ProbeRecorder = recordSnmpProbes(["10.0.0.4"]);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: undefined,
    });

    expect([...recorder.hosts].sort()).toEqual(ALL_SIX);
    expect(result.isIcmpOnlySweep).toBeUndefined();
  });

  it("probes SNMP when the field arrived as null from a JSON payload", async () => {
    mockPingAlive(ALL_SIX);
    const recorder: ProbeRecorder = recordSnmpProbes([]);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: null,
    } as unknown as Parameters<typeof SubnetScanner.scan>[0]);

    expect(recorder.hosts).toHaveLength(6);
    expect(result.isIcmpOnlySweep).toBeUndefined();
  });

  it("probes SNMP when the field is explicitly true", async () => {
    mockPingAlive(ALL_SIX);
    const recorder: ProbeRecorder = recordSnmpProbes(["10.0.0.4"]);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: true,
    });

    expect([...recorder.hosts].sort()).toEqual(ALL_SIX);
    expect(result.isIcmpOnlySweep).toBeUndefined();
    /*
     * The one host that answered SNMP carries its system group; the other
     * five are ping-only records. Both shapes are asserted here because the
     * ICMP-only record above is deliberately byte-identical to the ping-only
     * one this path writes, and a drift between them would send ICMP-only
     * hosts down a different import route.
     */
    expect(result.discoveredHosts).toEqual([
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.2", snmpReachable: false },
      { ipAddress: "10.0.0.3", snmpReachable: false },
      {
        ipAddress: "10.0.0.4",
        sysName: "device-10.0.0.4",
        sysDescr: undefined,
        sysObjectId: undefined,
        sysLocation: undefined,
        sysContact: undefined,
        sysUpTimeSeconds: undefined,
        snmpReachable: true,
      },
      { ipAddress: "10.0.0.5", snmpReachable: false },
      { ipAddress: "10.0.0.6", snmpReachable: false },
    ]);
  });

  /*
   * The ICMP-filtered fallback is the one behaviour most at risk from the new
   * gate: its condition gained an `isSnmpEnabled &&` term. An SNMP scan on a
   * segment that drops echo must still re-probe the ICMP-silent hosts, which
   * is the fix for issue #3078 — turning SNMP off for one scan must not have
   * turned that off for every other scan.
   */
  it("still runs the ICMP-filtered fallback for an SNMP scan", async () => {
    mockPingAlive([]);
    const recorder: ProbeRecorder = recordSnmpProbes(["10.0.0.4"]);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: true,
    });

    expect([...recorder.hosts].sort()).toEqual(ALL_SIX);
    expect(result.icmpFilteredFallbackHostCount).toBe(6);
    expect(discoveredAddresses(result)).toEqual(["10.0.0.4"]);
  });

  /*
   * The SNMP path's OWN ping-only record — the one the ICMP-only record above
   * is deliberately byte-identical to. A host that answers ICMP but not SNMP
   * is a real finding (printers, cameras, POS terminals, anything unmanaged),
   * and the code that keeps it sits directly under the new `!isSnmpEnabled`
   * early return. A gate that swallowed one line too many would drop those
   * hosts from every SNMP scan in the product and report a smaller result that
   * looks entirely plausible.
   *
   * So the fixture needs BOTH shapes: 10.0.0.1 answers SNMP, 10.0.0.3 answers
   * only ping. One SNMP responder also keeps the phase-3 fallback out of it,
   * so the recorder below is exactly the ping-alive pair.
   */
  it("still records ping-only hosts for an SNMP scan", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.3"]);
    const recorder: ProbeRecorder = recordSnmpProbes(["10.0.0.1"]);

    const withSnmp: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: true,
    });

    // Both ping-alive hosts were asked; only one answered.
    expect([...recorder.hosts].sort()).toEqual(["10.0.0.1", "10.0.0.3"]);
    expect(withSnmp.discoveredHosts).toEqual([
      {
        ipAddress: "10.0.0.1",
        sysName: "device-10.0.0.1",
        sysDescr: undefined,
        sysObjectId: undefined,
        sysLocation: undefined,
        sysContact: undefined,
        sysUpTimeSeconds: undefined,
        snmpReachable: true,
      },
      // Kept, not discarded — and shaped like an ICMP-only record.
      { ipAddress: "10.0.0.3", snmpReachable: false },
    ]);
    expect(withSnmp.isIcmpOnlySweep).toBeUndefined();
    expect(withSnmp.isIcmpSweepIncomplete).toBeUndefined();
  });

  /*
   * The two modes side by side on identical inputs. Everything that differs
   * here is a decision the toggle is supposed to make, and nothing else is.
   */
  it("differs from the SNMP sweep only in the SNMP-shaped fields", async () => {
    mockPingAlive(["10.0.0.2"]);
    recordSnmpProbes([]);

    const icmpOnly: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: false,
    });

    jest.restoreAllMocks();
    mockPingAlive(["10.0.0.2"]);
    recordSnmpProbes([]);

    const withSnmp: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      isSnmpEnabled: true,
    });

    // Same hosts found, same tallies.
    expect(icmpOnly.discoveredHosts).toEqual(withSnmp.discoveredHosts);
    expect(icmpOnly.scannedHostCount).toBe(withSnmp.scannedHostCount);
    expect(icmpOnly.respondedToPingCount).toBe(withSnmp.respondedToPingCount);

    // And only these differ.
    expect(icmpOnly.isIcmpOnlySweep).toBe(true);
    expect(withSnmp.isIcmpOnlySweep).toBeUndefined();
    expect(icmpOnly.scannedPort).toBeUndefined();
    expect(withSnmp.scannedPort).toBe(161);
    expect(icmpOnly.icmpFilteredFallbackHostCount).toBe(0);
    expect(withSnmp.icmpFilteredFallbackHostCount).toBe(5);
  });
});
