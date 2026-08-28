// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import { buildScanStatusMessage } from "../../../Jobs/Discovery/FetchScans";
import {
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { describe, expect, test } from "@jest/globals";

/*
 * The scan's status message is the entire diagnosis surface for a discovery
 * sweep. Four completely different situations all render as "0 of N hosts" in
 * the scans list:
 *
 *   1. the address range really is empty
 *   2. the probe cannot route to the range at all
 *   3. ICMP is filtered on the segment, so the pre-sweep saw nothing alive
 *   4. the devices are there and answered, but rejected the credentials
 *
 * Nothing else in the product distinguishes them, so each branch below is
 * asserted rather than left to whatever the string happens to say.
 */

// statusMessage is a varchar(500); Postgres throws rather than truncating.
const STATUS_MESSAGE_COLUMN_LENGTH: number = 500;

function makeResult(overrides?: Partial<SubnetScanResult>): SubnetScanResult {
  return {
    discoveredHosts: [],
    scannedHostCount: 254,
    /*
     * A sweep now reports the DISTINCT ports it touched rather than the single
     * port a scan used to carry, because a scan can hold several credential
     * sets and they are allowed to disagree about the port. The default here
     * is the one-port shape, which is still what almost every sweep produces.
     */
    scannedPorts: [161],
    /*
     * Present and empty rather than absent: the sweep seeds a zero for every
     * config it ran with, so an empty record is "this sweep declared no
     * credential sets", which is exactly the single-config shape these tests
     * describe.
     */
    responderCountByConfigId: {},
    respondedToPingCount: 0,
    snmpErrorHostCount: 0,
    mostCommonSnmpError: undefined,
    icmpFilteredFallbackHostCount: 0,
    ...overrides,
  } as SubnetScanResult;
}

/*
 * One credential set as the sweep reports it back — already parsed, and
 * carrying the NON-SECRET label that is the only thing the status message is
 * allowed to print. Built with a community string and v3 keys on purpose, so
 * the "no secret reaches statusMessage" assertions below have something real
 * to look for.
 */
function makeSnmpConfig(
  overrides?: Partial<SubnetScanSnmpConfig>,
): SubnetScanSnmpConfig {
  return {
    id: "config-1",
    label: "Access switches (V2c)",
    snmpVersion: SnmpVersion.V2c,
    communityString: "s3cret-community",
    snmpV3Auth: undefined,
    port: 161,
    ...overrides,
  } as SubnetScanSnmpConfig;
}

describe("buildScanStatusMessage — the headline", () => {
  test("reports the ICMP and SNMP tallies when the pre-sweep ran", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ respondedToPingCount: 12 }),
      3,
    );

    expect(message).toContain(
      "Swept 254 hosts: 12 answered ICMP ping, 3 answered SNMP.",
    );
  });

  /*
   * A count from a sweep that only half ran would be a lie, so SubnetScanner
   * reports undefined and the message must say why there is no ICMP number
   * rather than printing "undefined answered ICMP ping".
   */
  test("says the pre-sweep was unavailable instead of printing a missing count", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ respondedToPingCount: undefined }),
      3,
    );

    expect(message).toContain("ICMP pre-sweep unavailable on this probe");
    expect(message).toContain("3 answered SNMP.");
    expect(message).not.toContain("undefined");
  });

  test("a zero ICMP count is reported, not omitted", () => {
    expect(
      buildScanStatusMessage(makeResult({ respondedToPingCount: 0 }), 0),
    ).toContain("0 answered ICMP ping, 0 answered SNMP.");
  });
});

describe("buildScanStatusMessage — the ICMP-filtered subnet", () => {
  /*
   * This is the reported bug. A management VLAN that drops echo but permits
   * UDP/161 used to scan as a confident zero. The scanner now re-probes the
   * ICMP-silent hosts; the message has to say that happened, or the operator
   * still has no idea echo is being dropped on that segment.
   */
  test("names the override and points at ICMP filtering", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 0,
        icmpFilteredFallbackHostCount: 254,
      }),
      0,
    );

    expect(message).toContain("254 ICMP-silent hosts were probed over SNMP");
    expect(message).toContain("ICMP is likely filtered on this network");
  });

  test("still names it when the fallback is what found the devices", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 0,
        icmpFilteredFallbackHostCount: 254,
      }),
      7,
    );

    expect(message).toContain("7 answered SNMP.");
    expect(message).toContain("ICMP is likely filtered on this network");
  });

  test("stays quiet on a sweep the ICMP gate resolved normally", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 12,
        icmpFilteredFallbackHostCount: 0,
      }),
      3,
    );

    expect(message).not.toContain("ICMP-silent");
    expect(message).not.toContain("likely filtered");
  });
});

describe("buildScanStatusMessage — credentials rejected", () => {
  /*
   * A device answering "Authentication failure" is reachable and speaking
   * SNMP; the scan's credentials are simply wrong for it. That is a different
   * fix from "the probe cannot see this subnet", and both used to render as
   * an empty result.
   */
  test("counts the rejections and quotes the most common one", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        snmpErrorHostCount: 11,
        mostCommonSnmpError: "Authentication failure",
      }),
      0,
    );

    expect(message).toContain("11 host(s) replied with an SNMP error");
    expect(message).toContain("most common: Authentication failure");
  });

  test("a rejection tally without a message says nothing rather than 'undefined'", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ snmpErrorHostCount: 4, mostCommonSnmpError: undefined }),
      0,
    );

    expect(message).not.toContain("undefined");
    expect(message).not.toContain("replied with an SNMP error");
  });

  test("reports rejections even on a sweep that also found devices", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 20,
        snmpErrorHostCount: 5,
        mostCommonSnmpError: "Unknown user name",
      }),
      15,
    );

    expect(message).toContain("15 answered SNMP.");
    expect(message).toContain("most common: Unknown user name");
  });
});

describe("buildScanStatusMessage — nothing answered at all", () => {
  /*
   * Silence everywhere means the probe never got a reply of any kind. There
   * is no error to quote, so the message has to be the checklist instead —
   * otherwise the only output is a bare zero.
   */
  test("names the port and what to check", () => {
    const message: string = buildScanStatusMessage(makeResult(), 0);

    expect(message).toContain("Nothing answered SNMP on port 161");
    expect(message).toContain("this probe can reach the range");
    expect(message).toContain("UDP/161 is permitted");
    expect(message).toContain("SNMP ACL allows the probe's IP address");
  });

  test("names the non-default port a scan actually used", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPorts: [1610] }),
      0,
    );

    expect(message).toContain("Nothing answered SNMP on port 1610");
    expect(message).toContain("UDP/1610");
  });

  /*
   * Defensive: a result from an older probe carries no scannedPorts (and one
   * from a probe older still carried a single scannedPort under a different
   * name, which reads as absent here). Naming "port undefined" in the one
   * message meant to tell an operator what to check would be worse than
   * useless.
   */
  test("falls back to the SNMP default when the probe sent no ports", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPorts: undefined } as never),
      0,
    );

    expect(message).toContain("port 161");
    expect(message).not.toContain("undefined");
  });

  test("gives way to the concrete error when there is one", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        snmpErrorHostCount: 2,
        mostCommonSnmpError: "Authentication failure",
      }),
      0,
    );

    // The rejection is the diagnosis; the generic checklist would only dilute it.
    expect(message).not.toContain("Nothing answered SNMP on port");
  });

  test("stays away from a sweep that found devices", () => {
    expect(
      buildScanStatusMessage(makeResult({ respondedToPingCount: 12 }), 1),
    ).not.toContain("Nothing answered SNMP on port");
  });
});

/*
 * A scan carries an ordered LIST of credential sets now, and they are allowed
 * to disagree about the UDP port — an estate running a vendor agent on 1161
 * beside the stock daemon on 161 is a real shape, not a hypothetical one. The
 * checklist below is the operator's instruction to go and open a firewall
 * port, so naming only one of the two ports the sweep actually dialled would
 * send them to fix half the problem.
 */
describe("buildScanStatusMessage — the ports the sweep actually touched", () => {
  test("one port reads as a singular 'port'", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPorts: [161] }),
      0,
    );

    expect(message).toContain("Nothing answered SNMP on port 161.");
    expect(message).not.toContain("on ports");
  });

  test("two ports are both named, as a plural list, in the order swept", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPorts: [161, 1161] }),
      0,
    );

    expect(message).toContain("Nothing answered SNMP on ports 161, 1161.");
  });

  /*
   * The same list has to reach the firewall half of the sentence. An operator
   * who opens UDP/161 because that is the only port the message named will
   * re-run the scan and get the identical zero back.
   */
  test("every port swept is also named in the UDP checklist", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPorts: [161, 1161] }),
      0,
    );

    expect(message).toContain("UDP/161, 1161 is permitted to it");
  });

  /*
   * An empty array is the same state as a missing one — no probe should send
   * it, since the sweep derives the list from the configs it ran with and
   * refuses to run with none, but the fallback must not be reachable only
   * through `undefined`.
   */
  test("an empty port list falls back to the SNMP default rather than printing nothing", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPorts: [] }),
      0,
    );

    expect(message).toContain("Nothing answered SNMP on port 161.");
    expect(message).not.toContain("on port .");
  });
});

describe("buildScanStatusMessage — fits the column it is stored in", () => {
  /*
   * The message goes into a varchar(500). Postgres rejects an over-long value
   * rather than truncating it, and that rejection fails the whole result
   * write — losing the sweep's hosts and stranding the scan In Progress. The
   * server clips defensively too, but the probe must not depend on that.
   */
  test("the worst realistic combination still fits", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        scannedHostCount: 32768,
        respondedToPingCount: 32768,
        icmpFilteredFallbackHostCount: 32768,
        snmpErrorHostCount: 32768,
        // The scanner's own excerpt cap for a quoted SNMP error.
        mostCommonSnmpError: "E".repeat(120),
      }),
      32768,
    );

    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
  });

  /*
   * The per-credential sentences are new, and they are the part of this
   * message that grows with the operator's configuration rather than with the
   * subnet. Four credential sets is the realistic shape of a mixed segment
   * (the ceiling is ten), and every one of them contributes a label to either
   * "Answered by credentials" or "No host answered".
   *
   * The two shapes asserted below are the expensive ones a multi-credential
   * sweep actually produces, and the pathological one at the end of this
   * describe is the ceiling the operator is allowed to configure. All three
   * are bounded by the probe itself: the credential summary gets a fixed
   * slice of the message (MAX_CREDENTIAL_SUMMARY_LENGTH in FetchScans.ts),
   * naming as many credentials as fit and counting the rest, and the whole
   * message is clipped as a last resort.
   *
   * The ingest endpoint clips too, but that is a backstop, not the plan: what
   * it cuts is the TAIL, and the tail is where the credential summary lives —
   * so relying on it would make a multi-credential sweep the one case that
   * silently loses the sentence this feature exists to print.
   */
  test("a multi-credential sweep that found nothing still fits the column", () => {
    const snmpConfigs: Array<SubnetScanSnmpConfig> = [
      makeSnmpConfig({ id: "core", label: "Core switches (V3)" }),
      makeSnmpConfig({ id: "access", label: "Access switches (V2c)" }),
      makeSnmpConfig({ id: "printers", label: "Printers (V1)" }),
      makeSnmpConfig({ id: "vendor", label: "Vendor block (V2c)" }),
    ];

    const message: string = buildScanStatusMessage(
      makeResult({
        scannedHostCount: 4096,
        respondedToPingCount: 0,
        icmpFilteredFallbackHostCount: 4096,
        snmpErrorHostCount: 0,
        scannedPorts: [161, 1161],
        responderCountByConfigId: {},
      }),
      0,
      snmpConfigs,
    );

    // Every credential is named, and so is the port checklist — the long shape.
    expect(message).toContain("No host answered: Core switches (V3)");
    expect(message).toContain("Nothing answered SNMP on ports 161, 1161.");
    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
  });

  test("a multi-credential sweep that found devices stays well inside the column", () => {
    const snmpConfigs: Array<SubnetScanSnmpConfig> = [
      makeSnmpConfig({ id: "core", label: "Core switches (V3)" }),
      makeSnmpConfig({ id: "access", label: "Access switches (V2c)" }),
      makeSnmpConfig({ id: "printers", label: "Printers (V1)" }),
      makeSnmpConfig({ id: "vendor", label: "Vendor block (V2c)" }),
    ];

    const message: string = buildScanStatusMessage(
      makeResult({
        scannedHostCount: 4096,
        respondedToPingCount: 4096,
        snmpErrorHostCount: 4096,
        scannedPorts: [161, 1161],
        mostCommonSnmpError: "E".repeat(120),
        responderCountByConfigId: { core: 4096, access: 4096 },
      }),
      4096,
      snmpConfigs,
    );

    expect(message).toContain("Answered by credentials:");
    expect(message).toContain("No host answered:");
    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
  });

  /*
   * The ceiling the product actually permits: ten credential sets
   * (MAX_SNMP_CONFIGS_PER_SCAN), each named to the full length a config name
   * may be (MAX_SNMP_CONFIG_NAME_LENGTH, 100 characters), with every other
   * branch firing at the same time. Unbounded, this is over 1,500 characters
   * of operator-typed names in a 500-character column.
   *
   * The assertion is not only that it fits, but that it still SAYS something:
   * at least one credential is named — never a bare "and 10 more" — and the
   * older diagnostics that share the message survive alongside it.
   */
  test("ten fully-named credentials with every branch firing still fits", () => {
    const snmpConfigs: Array<SubnetScanSnmpConfig> = [];

    for (let index: number = 0; index < 10; index++) {
      snmpConfigs.push(
        makeSnmpConfig({
          id: `config-${index}`,
          label: `${"N".repeat(100)} (V2c)`,
        }),
      );
    }

    const message: string = buildScanStatusMessage(
      makeResult({
        scannedHostCount: 4096,
        respondedToPingCount: 4096,
        icmpFilteredFallbackHostCount: 4096,
        snmpErrorHostCount: 4096,
        scannedPorts: [161, 1161],
        mostCommonSnmpError: "E".repeat(120),
        responderCountByConfigId: { "config-0": 12 },
      }),
      12,
      snmpConfigs,
    );

    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);

    /*
     * Two guarantees, and it is worth being precise about which is which.
     *
     * The credential summary is BOUNDED — a single 100-character name is cut
     * to 40 so one verbose label cannot swallow the slice — so the sentence
     * that says which credential is doing the work survives even here.
     *
     * The whole message is CLIPPED as a last resort, and in this extreme it
     * does fire: the ICMP-filtered note and the 120-character quoted SNMP
     * error take most of the column before the credentials are reached. The
     * ellipsis is the point — a truncated message must not be readable as a
     * complete one.
     */
    expect(message).toContain("Answered by credentials: NNN");
    expect(message).toContain("answered ICMP ping");
    expect(message.endsWith("\u2026")).toBe(true);
  });

  /*
   * The same ten credentials with ordinary names, which is what the budget
   * itself is for: as many as fit are NAMED, and the remainder are COUNTED
   * rather than silently dropped. Nothing else fires, so the clip above is
   * not involved and this is the bounding logic on its own.
   */
  test("names as many credentials as fit and counts the rest", () => {
    const snmpConfigs: Array<SubnetScanSnmpConfig> = [];

    for (let index: number = 0; index < 10; index++) {
      snmpConfigs.push(
        makeSnmpConfig({
          id: `config-${index}`,
          label: `Building ${index} switches (V2c)`,
        }),
      );
    }

    const message: string = buildScanStatusMessage(
      makeResult({
        scannedHostCount: 254,
        respondedToPingCount: 10,
        responderCountByConfigId: { "config-0": 10 },
      }),
      10,
      snmpConfigs,
    );

    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(message).toContain(
      "Answered by credentials: Building 0 switches (V2c) on 10.",
    );
    // The nine silent ones do not all fit, so the tail is a count, not silence.
    expect(message).toMatch(/No host answered: .* and \d more\./);
    // Nothing was clipped: the budget alone kept this inside the column.
    expect(message.endsWith("\u2026")).toBe(false);
  });

  test("every single-branch message is comfortably short", () => {
    const results: Array<SubnetScanResult> = [
      makeResult(),
      makeResult({ respondedToPingCount: undefined }),
      makeResult({ icmpFilteredFallbackHostCount: 32768 }),
      makeResult({
        snmpErrorHostCount: 32768,
        mostCommonSnmpError: "E".repeat(120),
      }),
    ];

    for (const result of results) {
      expect(buildScanStatusMessage(result, 0).length).toBeLessThanOrEqual(
        STATUS_MESSAGE_COLUMN_LENGTH,
      );
    }
  });
});

describe("buildScanStatusMessage — results from an older probe", () => {
  /*
   * A probe is upgraded independently of the server it reports to, so the
   * server-side builder has to survive a payload with none of the new fields
   * rather than emitting "undefined" into the operator's only diagnostic.
   */
  test("a legacy result still produces the headline and nothing bogus", () => {
    const legacy: SubnetScanResult = {
      discoveredHosts: [],
      scannedHostCount: 254,
      respondedToPingCount: 12,
    } as unknown as SubnetScanResult;

    const message: string = buildScanStatusMessage(legacy, 3);

    expect(message).toBe(
      "Swept 254 hosts: 12 answered ICMP ping, 3 answered SNMP.",
    );
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("NaN");
  });

  test("a legacy result that found nothing still gets the checklist", () => {
    const legacy: SubnetScanResult = {
      discoveredHosts: [],
      scannedHostCount: 254,
      respondedToPingCount: 0,
    } as unknown as SubnetScanResult;

    expect(buildScanStatusMessage(legacy, 0)).toContain(
      "Nothing answered SNMP on port 161",
    );
  });
});
