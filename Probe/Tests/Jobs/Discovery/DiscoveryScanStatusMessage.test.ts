// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import { buildScanStatusMessage } from "../../../Jobs/Discovery/FetchScans";
import { SubnetScanResult } from "../../../Utils/Discovery/SubnetScanner";
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
    scannedPort: 161,
    respondedToPingCount: 0,
    snmpErrorHostCount: 0,
    mostCommonSnmpError: undefined,
    icmpFilteredFallbackHostCount: 0,
    ...overrides,
  } as SubnetScanResult;
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
      makeResult({ scannedPort: 1610 }),
      0,
    );

    expect(message).toContain("Nothing answered SNMP on port 1610");
    expect(message).toContain("UDP/1610");
  });

  /*
   * Defensive: a result from an older probe carries no scannedPort. Naming
   * "port undefined" in the one message meant to tell an operator what to
   * check would be worse than useless.
   */
  test("falls back to the SNMP default when the probe sent no port", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPort: undefined } as never),
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
