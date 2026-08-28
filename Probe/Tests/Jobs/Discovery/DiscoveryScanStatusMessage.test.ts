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

/*
 * statusMessage is a varchar(500). Postgres would throw rather than truncate,
 * so the ingest endpoint never lets it get that far: it clips the value with
 * substring(0, 500) just before the write
 * (App/FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan.ts). An over-long
 * message therefore costs the tail of a sentence, not the whole scan result —
 * which is why the ORDER of the sentences below is asserted as carefully as
 * their content.
 */
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

/*
 * github.com/OneUptime/oneuptime/issues/3445 — a scan can now be an ICMP ping
 * sweep and nothing else.
 *
 * Every SNMP number a sweep reports is zero in that mode, for a reason that
 * has nothing to do with the network: nothing ever asked. Each of those zeroes
 * reads as a finding if the SNMP wording is reused, and one of them is worse
 * than misleading — the "nothing answered" branch fires on
 * `snmpResponderCount === 0 && snmpErrorHostCount === 0`, and BOTH are
 * structurally true on every ICMP-only sweep. A perfectly healthy ping sweep
 * that found twelve hosts would be annotated "Nothing answered SNMP on port
 * 161. Check that UDP/161 is permitted to it", sending the operator to a
 * firewall rule for traffic the probe never sent.
 *
 * So the ICMP-only branch returns early, and the tests below assert both what
 * it says and what it must not say.
 */
function makeIcmpOnlyResult(
  overrides?: Partial<SubnetScanResult>,
): SubnetScanResult {
  return {
    discoveredHosts: [],
    scannedHostCount: 254,
    /*
     * No port was dialled, so there is none to report. The SNMP fixture above
     * sets 161; an ICMP-only sweep that carried a port would be describing a
     * probe it never sent.
     */
    scannedPort: undefined,
    respondedToPingCount: 12,
    snmpErrorHostCount: 0,
    mostCommonSnmpError: undefined,
    icmpFilteredFallbackHostCount: 0,
    isIcmpOnlySweep: true,
    isIcmpSweepIncomplete: false,
    ...overrides,
  } as SubnetScanResult;
}

describe("buildScanStatusMessage — an ICMP-only sweep", () => {
  test("names the host count and says SNMP checking is off", () => {
    const message: string = buildScanStatusMessage(makeIcmpOnlyResult(), 0);

    expect(message).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping.",
    );
  });

  test("counts the hosts that answered ping, not the hosts that were swept", () => {
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({ scannedHostCount: 1024, respondedToPingCount: 3 }),
        0,
      ),
    ).toContain("Swept 1024 hosts with ICMP ping only");
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({ scannedHostCount: 1024, respondedToPingCount: 3 }),
        0,
      ),
    ).toContain("3 answered ping.");
  });

  /*
   * The whole reason this branch exists. `snmpResponderCount === 0 &&
   * snmpErrorHostCount === 0` is structurally true for every ICMP-only sweep,
   * so the SNMP "nothing answered" advice would otherwise be appended to a
   * HEALTHY ping sweep — twelve hosts found, and a paragraph telling the
   * operator to open UDP/161 for a datagram that was never sent.
   */
  test("never mentions SNMP responders, port 161 or UDP", () => {
    const message: string = buildScanStatusMessage(makeIcmpOnlyResult(), 0);

    expect(message).not.toContain("Nothing answered SNMP");
    expect(message).not.toContain("answered SNMP");
    expect(message).not.toContain("port 161");
    expect(message).not.toContain("UDP");
    expect(message).not.toContain("SNMP ACL");
    expect(message).not.toContain("ICMP pre-sweep unavailable");
  });

  test("says nothing about SNMP even when no host answered ping", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({ respondedToPingCount: 0 }),
      0,
    );

    expect(message).not.toContain("Nothing answered SNMP");
    expect(message).not.toContain("port 161");
    expect(message).not.toContain("UDP");
  });

  /*
   * A result should never carry these in ICMP-only mode — SubnetScanner hard-
   * codes them to zero on that path — but the branch must not start rendering
   * SNMP advice if one ever does. The mode is the deciding fact, not the
   * numbers.
   */
  test("ignores stray SNMP tallies rather than re-opening the SNMP wording", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        snmpErrorHostCount: 9,
        mostCommonSnmpError: "Authentication failure",
        icmpFilteredFallbackHostCount: 242,
        scannedPort: 161,
      }),
      4,
    );

    expect(message).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping.",
    );
    expect(message).not.toContain("Authentication failure");
    expect(message).not.toContain("ICMP-silent");
  });

  /*
   * snmpResponderCount is computed by runScan from discoveredHosts, where
   * every ICMP-only host carries snmpReachable false — so it is always 0 here.
   * The branch must not read it anyway: a caller that got it wrong should not
   * be able to make an ICMP-only sweep claim SNMP responders.
   */
  test("does not report a caller-supplied SNMP responder count", () => {
    /*
     * Asserted as the whole string rather than as `.not.toContain("7")`: that
     * matcher passes on any message that happens to lack the digit, including
     * one that leaked the count in some other spelling.
     */
    expect(buildScanStatusMessage(makeIcmpOnlyResult(), 7)).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping.",
    );
  });

  /*
   * The COUNT decides the wording; the host list is never consulted. The two
   * cannot disagree on a result SubnetScanner built — the ICMP-only branch
   * derives the list and the count from the same Set — but the fallback here is
   * `?? 0`, so a result that lost its count while keeping its hosts would be
   * announced as "Nothing answered ICMP ping." over a list of hosts that
   * plainly did. Pinned so that the day it becomes reachable, this is what says
   * so rather than a support ticket.
   */
  test("the ping count decides the wording, even when hosts are listed", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        discoveredHosts: [
          { ipAddress: "10.0.0.5", snmpReachable: false },
          { ipAddress: "10.0.0.9", snmpReachable: false },
        ],
        respondedToPingCount: undefined,
      }),
      0,
    );

    expect(message).toContain("0 answered ping.");
    expect(message).toContain("Nothing answered ICMP ping.");
  });

  test("reads a missing ping count as zero rather than printing 'undefined'", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({ respondedToPingCount: undefined }),
      0,
    );

    expect(message).toContain("0 answered ping.");
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("NaN");
  });
});

describe("buildScanStatusMessage — an ICMP-only sweep that found nothing", () => {
  /*
   * The one outcome an operator will open a support ticket about. "0 of 254"
   * on a ping-only scan has three completely different causes — an empty
   * range, a probe that cannot route to it, and hosts that simply drop echo —
   * and the last is the common one, because Windows blocks ICMP by default and
   * management VLANs usually do too. The checklist has to name all three, and
   * point at the toggle that would find those hosts anyway.
   */
  test("gives the ICMP checklist instead of the SNMP one", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({ respondedToPingCount: 0 }),
      0,
    );

    expect(message).toContain("Nothing answered ICMP ping.");
    expect(message).toContain("this probe can reach the range");
    expect(message).toContain("ICMP echo is permitted to it");
  });

  test("names the hosts that drop ping by default", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({ respondedToPingCount: 0 }),
      0,
    );

    expect(message).toContain("Windows hosts do by default");
    expect(message).toContain("management VLANs often do");
  });

  /*
   * The way out, in the wizard's own words. "Check SNMP" is the label on the
   * toggle, so the advice can be followed without a translation step.
   */
  test("points at the Check SNMP toggle as the way to find them", () => {
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({ respondedToPingCount: 0 }),
        0,
      ),
    ).toContain("turn Check SNMP on if you expect managed devices here");
  });

  test("stays away from a sweep that did find hosts", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({ respondedToPingCount: 1 }),
      0,
    );

    expect(message).not.toContain("Nothing answered ICMP ping.");
    expect(message).not.toContain("Windows hosts");
  });

  test("a missing ping count is treated as nothing found, so the checklist still appears", () => {
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({ respondedToPingCount: undefined }),
        0,
      ),
    ).toContain("Nothing answered ICMP ping.");
  });
});

describe("buildScanStatusMessage — an ICMP-only sweep that stopped early", () => {
  /*
   * The pre-sweep died partway: some hosts were confirmed, the rest of the
   * range was never checked. Those confirmed hosts are real and worth
   * reporting, but the tally beside them covers an unknown fraction of the
   * target — read without the caveat it says "254 swept, 3 alive", which is a
   * conclusion the sweep did not earn.
   */
  test("carries the stopped-early caveat", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        respondedToPingCount: 3,
        isIcmpSweepIncomplete: true,
      }),
      0,
    );

    expect(message).toContain("This ping sweep stopped early");
    expect(message).toContain("an unknown part of the range was never checked");
    expect(message).toContain(
      "The hosts reported are the ones confirmed before it stopped.",
    );
  });

  /*
   * ORDER IS LOAD-BEARING. statusMessage is a varchar(500) and the ingest
   * endpoint clips it with substring(0, 500) rather than rejecting it, so
   * whatever sits at the end is what disappears. The caveat is the sentence
   * that makes the number beside it readable, so it goes first and the tally
   * follows.
   */
  test("puts the caveat before the tally, not after it", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        respondedToPingCount: 3,
        isIcmpSweepIncomplete: true,
      }),
      0,
    );

    expect(message.indexOf("This ping sweep stopped early")).toBe(0);
    expect(message.indexOf("This ping sweep stopped early")).toBeLessThan(
      message.indexOf("Swept 254 hosts with ICMP ping only"),
    );
  });

  test("still names the tally after the caveat", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        respondedToPingCount: 3,
        isIcmpSweepIncomplete: true,
      }),
      0,
    );

    expect(message).toContain(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 3 answered ping.",
    );
  });

  test("a completed sweep carries no caveat at all", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({ isIcmpSweepIncomplete: false }),
      0,
    );

    expect(message).not.toContain("stopped early");
  });

  /*
   * Absent, not false. SubnetScanner sets the flag to `!isPingSweepAvailable`
   * so a clean sweep gets an explicit false, but a fixture or an older payload
   * simply will not have it — and "no flag" has to mean "complete", never
   * "unknown, so warn".
   */
  test("an absent incomplete flag reads as a completed sweep", () => {
    const result: SubnetScanResult = makeIcmpOnlyResult();
    delete result.isIcmpSweepIncomplete;

    expect(buildScanStatusMessage(result, 0)).not.toContain("stopped early");
  });

  test("an incomplete sweep that also found nothing carries both sentences", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        respondedToPingCount: 0,
        isIcmpSweepIncomplete: true,
      }),
      0,
    );

    expect(message).toContain("This ping sweep stopped early");
    expect(message).toContain("Nothing answered ICMP ping.");
    // And the caveat is still the part that survives a clip.
    expect(message.indexOf("This ping sweep stopped early")).toBe(0);
  });
});

describe("buildScanStatusMessage — the ICMP-only message and the column it lands in", () => {
  /*
   * statusMessage is a varchar(500). The ingest endpoint clips at exactly that
   * length rather than letting Postgres reject the write, so an over-long
   * message costs the tail of the sentence rather than the whole result — but
   * the probe should not be writing one in the first place.
   *
   * The realistic worst case is one branch plus the headline: SubnetScanner
   * throws instead of returning when the ping sweep is unusable AND nothing
   * was confirmed, so "stopped early" and "nothing answered" cannot both be
   * true on a result that reaches here.
   */
  test("every reachable ICMP-only message fits the column", () => {
    const results: Array<SubnetScanResult> = [
      makeIcmpOnlyResult(),
      makeIcmpOnlyResult({ respondedToPingCount: 0 }),
      makeIcmpOnlyResult({ respondedToPingCount: undefined }),
      makeIcmpOnlyResult({
        scannedHostCount: 32768,
        respondedToPingCount: 32768,
        isIcmpSweepIncomplete: true,
      }),
    ];

    for (const result of results) {
      expect(buildScanStatusMessage(result, 0).length).toBeLessThanOrEqual(
        STATUS_MESSAGE_COLUMN_LENGTH,
      );
    }
  });

  test("the largest possible counts do not blow the column", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        // The scan-target ceiling: 32,768 addresses, all of them alive.
        scannedHostCount: 32768,
        respondedToPingCount: 32768,
      }),
      32768,
    );

    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
  });

  /*
   * The one combination that does NOT fit: caveat (196) + headline (89) +
   * checklist (285) is 572 characters, and SubnetScanner cannot produce it
   * (an unusable ping sweep that confirmed nothing throws instead of
   * returning). It is asserted anyway, because it is the only case that says
   * WHAT THE CLIP COSTS, and the answer has to be "the tail of the advice" —
   * never the caveat that makes the number readable, and never the number.
   *
   * Containment alone would not say that: caveat + headline is 286 characters,
   * so both survive a 500-character clip under every ordering of the three
   * parts. The assertions below are therefore positional — the caveat starts
   * the message, the headline is present WHOLE, and the last clause of the
   * advice is the part that falls off the end. Moving any parts.push in
   * buildScanStatusMessage breaks at least one of them.
   */
  test("the clip costs the tail of the advice, never the caveat or the tally", () => {
    const message: string = buildScanStatusMessage(
      makeIcmpOnlyResult({
        scannedHostCount: 32768,
        respondedToPingCount: 0,
        isIcmpSweepIncomplete: true,
      }),
      0,
    );

    // The premise: this really is a message the server has to clip.
    expect(message.length).toBeGreaterThan(STATUS_MESSAGE_COLUMN_LENGTH);

    const clipped: string = message.substring(0, STATUS_MESSAGE_COLUMN_LENGTH);
    expect(clipped.indexOf("This ping sweep stopped early")).toBe(0);
    expect(clipped).toContain(
      "The hosts reported are the ones confirmed before it stopped.",
    );
    // Whole, not clipped through the middle of the count.
    expect(clipped).toContain(
      "Swept 32768 hosts with ICMP ping only (Check SNMP is off for this scan): 0 answered ping.",
    );

    // And what is lost is the last clause of the advice, which is the least of it.
    expect(message).toContain(
      "turn Check SNMP on if you expect managed devices here",
    );
    expect(clipped).not.toContain(
      "turn Check SNMP on if you expect managed devices here",
    );
  });
});

describe("buildScanStatusMessage — the SNMP branch is unchanged by all of this", () => {
  /*
   * THE INVARIANT THE WHOLE CHANGE RESTS ON, at this layer.
   *
   * The flag is read POSITIVELY (`if (scanResult.isIcmpOnlySweep)`) so that a
   * result built without it — every fixture in this file above, every payload
   * from a probe or code path that predates the field — keeps describing the
   * SNMP sweep it actually was. Reading the absence as "ICMP-only" would strip
   * the SNMP diagnosis out of every scan in the product, and the messages would
   * still look perfectly plausible.
   */
  test("a result with no isIcmpOnlySweep field takes the SNMP branch", () => {
    const legacy: SubnetScanResult = makeResult({ respondedToPingCount: 12 });

    expect(legacy.isIcmpOnlySweep).toBeUndefined();
    expect(buildScanStatusMessage(legacy, 3)).toBe(
      "Swept 254 hosts: 12 answered ICMP ping, 3 answered SNMP.",
    );
  });

  test("a result with isIcmpOnlySweep explicitly false takes the SNMP branch", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ respondedToPingCount: 12, isIcmpOnlySweep: false }),
      3,
    );

    expect(message).toBe(
      "Swept 254 hosts: 12 answered ICMP ping, 3 answered SNMP.",
    );
  });

  test("a legacy zero-host result still gets the SNMP checklist, not the ICMP one", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ respondedToPingCount: 0 }),
      0,
    );

    expect(message).toContain("Nothing answered SNMP on port 161");
    expect(message).not.toContain("Nothing answered ICMP ping.");
    expect(message).not.toContain("Check SNMP is off for this scan");
  });

  /*
   * An SNMP sweep never sets isIcmpSweepIncomplete, and the caveat belongs to
   * the ICMP-only branch alone — an SNMP sweep whose pre-sweep broke falls back
   * to probing every host, which is a complete sweep by a different route and
   * already says so ("ICMP pre-sweep unavailable on this probe").
   */
  test("an SNMP sweep never renders the stopped-early caveat", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: undefined,
        isIcmpSweepIncomplete: true,
      }),
      3,
    );

    expect(message).not.toContain("stopped early");
    expect(message).toContain("ICMP pre-sweep unavailable on this probe");
  });
});
