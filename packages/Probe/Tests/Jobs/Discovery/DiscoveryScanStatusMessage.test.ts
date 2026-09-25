// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  buildHostNamingNote,
  buildScanStatusMessage,
  formatNamingBudget,
  HostNamingNoteForm,
} from "../../../Jobs/Discovery/FetchScans";
import { MAX_NETBIOS_MAX_HOSTS_OVERRIDE } from "../../../Utils/Discovery/NetbiosNameResolver";
import { MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS } from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  NetbiosNamingOutcome,
  ReverseDnsNamingOutcome,
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { describe, expect, test } from "@jest/globals";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

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

/*
 * MAX_CREDENTIAL_LABEL_LENGTH in FetchScans.ts, which is not exported.
 *
 * Mirrored rather than imported on purpose: the assertions below are about the
 * PROMISE — "one operator-typed name is printed in at most forty characters" —
 * and importing the module's own number would make them agree with whatever it
 * happens to hold, including nothing at all.
 */
const MAX_CREDENTIAL_LABEL_LENGTH: number = 40;

/*
 * A config label longer than that cap, in the shape an operator really types.
 *
 * Deliberately not `"N".repeat(100)`: a run of identical characters is cut
 * invisibly — the truncated and untruncated forms share every prefix — so a
 * `toContain` on the head of such a label is satisfied whether the cap fired
 * or not. That is precisely the hole in the neighbouring "ten fully-named
 * credentials" test, and repeating the trick here would reproduce it.
 */
const VERBOSE_LABEL: string =
  "Datacenter east row 4 core and distribution switches (V3)";

/*
 * The other side of the boundary: a label exactly AT the cap, which must be
 * printed whole. Its length is asserted in the test rather than trusted, so a
 * later edit to the wording cannot quietly turn this into a second
 * over-the-cap case that passes for the wrong reason.
 */
const EXACTLY_AT_CAP_LABEL: string = "Distribution switches - building 12 (V1)";

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

/*
 * Reverse DNS (issue #3529) runs at the end of scanWithDeadline, on whatever
 * hosts the sweep returned — including the hosts a MOCKED SubnetScanner.scan
 * hands back. Stubbed for this whole file so no test here queries the
 * machine's real resolver; ReverseDnsStubIntegrity.test.ts fails the build if
 * a file that drives this path forgets.
 */
stubReverseDnsAsResolvingNothing();

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
   * The per-label cap, asserted directly \u2014 because the test immediately above
   * does NOT assert it, despite saying so in its own comment.
   *
   * `toContain("Answered by credentials: NNN")` is satisfied by the first
   * three N of an UNTRUNCATED hundred-character label exactly as well as by a
   * truncated one. Delete summarizeConfigLabel's cap entirely and that test
   * stays green: the whole-message clip still holds the length inside the
   * column, and the only casualty is WHICH sentences survive to be read. So
   * the cap is pinned here on its own, against a message where no other
   * branch fires and the printed label can be looked at directly.
   *
   * What the cap buys: a config name may be as long as a scan name
   * (MAX_SNMP_CONFIG_NAME_LENGTH, 100 characters), while the entire credential
   * summary gets 120. Uncapped, ONE verbose name eats the budget, and the
   * sentence that exists to tell the operator which credential is doing the
   * work names that one and counts the other nine \u2014 on a sweep where the
   * interesting answer is usually one of the nine.
   */
  test("a label longer than the cap is printed cut to exactly the cap, ellipsis included", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 4,
        responderCountByConfigId: { access: 4 },
      }),
      4,
      [
        makeSnmpConfig({ id: "access", label: "Access switches (V2c)" }),
        makeSnmpConfig({ id: "core", label: VERBOSE_LABEL }),
      ],
    );

    /*
     * The label as the operator would read it, pulled back out of the sentence
     * rather than recomputed. Re-deriving `substring(0, 39) + "\u2026"` here would
     * be the production line copied into its own test, and would agree with
     * the module however it were rewritten.
     */
    const printed: RegExpMatchArray | null = message.match(
      /No host answered: (.+)\.$/,
    );

    expect(printed).not.toBeNull();

    const printedLabel: string = printed![1]!;

    expect(printedLabel.length).toBe(MAX_CREDENTIAL_LABEL_LENGTH);
    /*
     * The ellipsis counts toward the forty and has to be there: a name cut at
     * a word boundary reads as the operator's actual name, and they would go
     * looking for a config card that does not exist.
     */
    expect(printedLabel.endsWith("\u2026")).toBe(true);
    // What survived is the head of their own name, not a rewrite of it.
    expect(VERBOSE_LABEL.startsWith(printedLabel.slice(0, -1))).toBe(true);
    // And the untruncated name is nowhere in the message.
    expect(message).not.toContain(VERBOSE_LABEL);
  });

  /*
   * The same cap on the other sentence. The two are built by separate loops
   * over the same list, so a cap applied to one and not the other is a live
   * regression \u2014 and "Answered by credentials" is the sentence a long name is
   * most likely to appear in, because a credential that answers is one the
   * operator bothered to name carefully.
   */
  test("the cap applies to a credential that answered as well as to a silent one", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 4,
        responderCountByConfigId: { core: 4 },
      }),
      4,
      [
        makeSnmpConfig({ id: "core", label: VERBOSE_LABEL }),
        makeSnmpConfig({ id: "access", label: "Access switches (V2c)" }),
      ],
    );

    const printed: RegExpMatchArray | null = message.match(
      /Answered by credentials: (.+) on 4\./,
    );

    expect(printed).not.toBeNull();

    const printedLabel: string = printed![1]!;

    expect(printedLabel.length).toBe(MAX_CREDENTIAL_LABEL_LENGTH);
    expect(printedLabel.endsWith("\u2026")).toBe(true);
    expect(VERBOSE_LABEL.startsWith(printedLabel.slice(0, -1))).toBe(true);
    expect(message).not.toContain(VERBOSE_LABEL);
  });

  /*
   * The boundary from the other side. Almost every real label is well under
   * the cap, and a cap that fired one character early would put an ellipsis on
   * names that fit \u2014 turning "Printers (V1)" into something the operator
   * cannot match against the card in front of them, for no gain at all.
   */
  test("a label exactly at the cap is printed whole, with no ellipsis", () => {
    // Asserted, not assumed: the constant is the boundary or this proves nothing.
    expect(EXACTLY_AT_CAP_LABEL.length).toBe(MAX_CREDENTIAL_LABEL_LENGTH);

    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 4,
        responderCountByConfigId: { access: 4 },
      }),
      4,
      [
        makeSnmpConfig({ id: "access", label: "Access switches (V2c)" }),
        makeSnmpConfig({ id: "printers", label: EXACTLY_AT_CAP_LABEL }),
      ],
    );

    expect(message).toContain(`No host answered: ${EXACTLY_AT_CAP_LABEL}.`);
    expect(message).not.toContain("\u2026");
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
     * sets [161]; an ICMP-only sweep that carried a port would be describing a
     * probe it never sent. (A LIST since issue #3458 — a scan's credential sets
     * may disagree on the port — where this was a single optional number.)
     */
    scannedPorts: [],
    responderCountByConfigId: {},
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
        scannedPorts: [161],
        /*
         * A stray per-credential tally as well, for the same reason as the
         * SNMP ones beside it: an ICMP-only sweep tried no credential, so the
         * summary must not start naming them however the result is shaped.
         */
        responderCountByConfigId: { "config-1": 4 },
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
   * The one combination that does not fit on its own: caveat (196) + headline
   * (89) + checklist (285) is 572 characters, and SubnetScanner cannot produce
   * it (an unusable ping sweep that confirmed nothing throws instead of
   * returning). It is asserted anyway, because it is the only case that says
   * WHAT THE CLIP COSTS, and the answer has to be "the tail of the advice" —
   * never the caveat that makes the number readable, and never the number.
   *
   * The PROBE does the clipping, not the server. It used to be the other way
   * round on this path: the message was returned at its full 572 characters
   * and the ingest endpoint cut it to fit the column. That was a worse place
   * for the decision — the server clips blind, and this file's own contract is
   * that the probe keeps itself inside the column — so buildScanStatusMessage
   * now clips every one of its returns and marks the cut.
   *
   * Containment alone would not say what is lost: caveat + headline is 286
   * characters, so both survive a 500-character clip under every ordering of
   * the three parts. The assertions are therefore positional — the caveat
   * starts the message, the headline is present WHOLE, and the last clause of
   * the advice is the part that falls off the end. Moving any parts.push in
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

    /*
     * The premise: this is a message that had to be cut. It comes back at
     * exactly the column width with the ellipsis that marks the cut, rather
     * than over the width and left for the server — a truncated message must
     * not be readable as a complete one.
     */
    expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(message.endsWith("\u2026")).toBe(true);

    expect(message.indexOf("This ping sweep stopped early")).toBe(0);
    expect(message).toContain(
      "The hosts reported are the ones confirmed before it stopped.",
    );
    // Whole, not clipped through the middle of the count.
    expect(message).toContain(
      "Swept 32768 hosts with ICMP ping only (Check SNMP is off for this scan): 0 answered ping.",
    );

    // And what is lost is the last clause of the advice, which is the least of it.
    expect(message).not.toContain(
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

/*
 * OneUptime issue #3677 — naming a big sweep's hosts can be cut short, and it
 * used to happen silently.
 *
 * Reverse DNS runs against a wall-clock budget and NetBIOS against a host cap,
 * a budget and a UDP socket that may not bind. Each of those stops leaves hosts
 * without the name that pass would have given them, and the only trace was a
 * logger.warn on the probe. From the scans list that is indistinguishable from
 * "these addresses have no PTR record", so an operator with 2,700 unnamed
 * hosts had no way to learn that raising one environment variable would name
 * them.
 *
 * The note that says so is the only place those facts reach the product, so
 * its wording (in its FULL and its COMPACT form), its silence on healthy
 * passes, and the order in which the status message gives things up to stay
 * inside the column are all asserted below.
 */

/*
 * MAX_NAMING_REASON_EXCERPT_LENGTH, MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH
 * and MIN_CLIPPED_SENTENCE_TAIL_LENGTH in FetchScans.ts, which are not
 * exported.
 *
 * Mirrored rather than imported for the reason MAX_CREDENTIAL_LABEL_LENGTH
 * gives above: "a quoted reason is at most 80 characters in a full sentence
 * and 40 in a compact one, ellipsis included" and "a clipped tail shorter than
 * 20 characters becomes a lone ellipsis" are the promises under test, and
 * importing the module's own numbers would make the tests agree with any value
 * at all. The column itself is STATUS_MESSAGE_COLUMN_LENGTH, already mirrored
 * at the top of this file.
 */
const MAX_NAMING_REASON_EXCERPT_LENGTH: number = 80;
const MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH: number = 40;
const MIN_CLIPPED_SENTENCE_TAIL_LENGTH: number = 20;

/*
 * The most PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS may be set to: twenty
 * minutes. Past it Config falls back to AUTOMATIC sizing, so the note must stop
 * advising the operator to "raise" the variable at exactly this value.
 *
 * Mirrored for the same reason as the lengths above, and then checked against
 * the export in its own test: the boundary tests must be about twenty minutes,
 * not about whatever the constant holds, but a drift between this number and
 * the one Config enforces is a real bug that should fail loudly rather than
 * leave the boundary tests asserting a ceiling nothing uses.
 */
const REVERSE_DNS_BUDGET_OVERRIDE_CEILING_IN_MS: number = 20 * 60 * 1000;

/*
 * The knob the time-limit sentence tells the operator to turn. Spelled out
 * here rather than read from Config.ts: a rename on the probe that forgot the
 * message would otherwise keep this green while sending operators to set a
 * variable nothing reads.
 */
const REVERSE_DNS_BUDGET_ENV_VAR: string =
  "PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS";

/*
 * The most PROBE_DISCOVERY_NETBIOS_MAX_HOSTS may be set to: 4,000 hosts, the
 * cap the NetBIOS budget can still cover. A lookup already running at or above
 * it cannot be raised any further, so the cap sentence must stop offering the
 * knob there.
 *
 * Mirrored, and checked against the export in its own test, for the reason
 * REVERSE_DNS_BUDGET_OVERRIDE_CEILING_IN_MS gives.
 */
const NETBIOS_MAX_HOSTS_CEILING: number = 4000;

/*
 * The knob the cap sentence tells the operator to turn. Spelled out rather
 * than read from Config.ts, for the reason REVERSE_DNS_BUDGET_ENV_VAR gives:
 * a rename on the probe that forgot this message would otherwise keep the
 * tests green while sending operators to set a variable nothing reads.
 */
const NETBIOS_MAX_HOSTS_ENV_VAR: string = "PROBE_DISCOVERY_NETBIOS_MAX_HOSTS";

/*
 * Error text longer than the excerpt cap, in the shape a resolver or socket
 * really reports it. Not a run of one character, for the reason VERBOSE_LABEL
 * gives: a repeated character is cut invisibly, so a prefix check on it passes
 * whether the cap fired or not.
 */
const LONG_RESOLVER_ERROR: string =
  "queryPtr ETIMEOUT: resolver 127.0.0.11:53 stopped answering PTR queries for 10.in-addr.arpa after the first wave";

const LONG_SOCKET_REASON: string =
  "bind EADDRNOTAVAIL 0.0.0.0:137 because the probe container has no interface that can reach this segment over UDP";

/*
 * The reason NetbiosNameResolver really reports for a socket that never bound
 * (see its bind-timeout branch). A whole sentence, trailing period included,
 * which is exactly the shape quoteReason exists for: inside parentheses that
 * period would double the punctuation of the sentence around it.
 */
const BIND_TIMEOUT_REASON: string = "The UDP socket did not bind in time.";

/*
 * A resolver reason in the shape ReverseDnsResolver hands up for a broken
 * probe resolver: short enough to be quoted whole in either form, so a test
 * built on it is about the note's wording rather than about the excerpt.
 */
const BROKEN_RESOLVER_REASON: string = "queryPtr ECONNREFUSED 127.0.0.11:53";

/*
 * The reverse-DNS note for the canonical large sweep that ran out of time:
 * 4,000 hosts, 1,200 named, 2,700 never asked, under the 10-minute automatic
 * ceiling. Written out whole once, in both forms, so every integration test
 * that expects it on the end of a message is checking the real sentence rather
 * than one this file assembled.
 */
const EXHAUSTED_REVERSE_DNS_NOTE: string =
  "Reverse DNS named 1,200 of 4,000 hosts before its 10m time limit; 2,700 were never looked up " +
  "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).";

/*
 * The compact form of the same sentence. It names the budget as "10m limit"
 * rather than "10m time limit": the word the sentence around it already
 * implies is exactly what the compact form exists to drop, and dropping it is
 * also what makes this sentence shorter than the full one it stands in for.
 */
const EXHAUSTED_REVERSE_DNS_COMPACT_NOTE: string =
  "Reverse DNS hit its 10m limit; 2,700 of 4,000 hosts not looked up.";

// The same 4,000-host sweep whose resolver never answered, with no reason given.
const UNAVAILABLE_REVERSE_DNS_NOTE: string =
  "Reverse DNS lookups from this probe got no answers, so none of the 4,000 hosts got a reverse DNS name - " +
  "check the probe's DNS resolver and the reverse DNS zone for this range.";

/*
 * The canonical NetBIOS cap sentences: a 3,500-host lookup against the default
 * 2,000-host cap, so 1,500 unnamed hosts were never asked. The full form ends
 * with the knob that raises the cap, because the default is a long way under
 * the ceiling; the compact form never carries advice.
 */
const NETBIOS_CAP_NOTE: string =
  "NetBIOS lookups are capped at 2,000 hosts per scan, so 1,500 unnamed hosts were not asked " +
  "(raise PROBE_DISCOVERY_NETBIOS_MAX_HOSTS on the probe to ask more).";

const NETBIOS_CAP_COMPACT_NOTE: string =
  "NetBIOS skipped 1,500 hosts over its 2,000-host cap.";

/*
 * The ICMP-only sentences, spelled out whole. The tests near the top of this
 * file pin each of them by content; here they are needed WHOLE, because the
 * composition tests below say exactly which of them survive a clip, and a
 * premise test checks these constants against the real message before any
 * test relies on them.
 */
const ICMP_STOPPED_EARLY_CAVEAT: string =
  "This ping sweep stopped early - the probe could not keep sending ICMP echo requests, " +
  "so an unknown part of the range was never checked. " +
  "The hosts reported are the ones confirmed before it stopped.";

const ICMP_NOTHING_ANSWERED_ADVICE: string =
  "Nothing answered ICMP ping. Check that this probe can reach the range and that ICMP echo is permitted to it. " +
  "Hosts that drop ping - Windows hosts do by default, and management VLANs often do - cannot be found by an ICMP-only scan; " +
  "turn Check SNMP on if you expect managed devices here.";

function icmpOnlyHeadline(scannedHostCount: number, answered: number): string {
  return `Swept ${scannedHostCount} hosts with ICMP ping only (Check SNMP is off for this scan): ${answered} answered ping.`;
}

function snmpHeadline(
  scannedHostCount: number,
  respondedToPingCount: number | undefined,
  snmpResponderCount: number,
): string {
  return respondedToPingCount !== undefined
    ? `Swept ${scannedHostCount} hosts: ${respondedToPingCount} answered ICMP ping, ${snmpResponderCount} answered SNMP.`
    : `Swept ${scannedHostCount} hosts via SNMP (ICMP pre-sweep unavailable on this probe): ${snmpResponderCount} answered SNMP.`;
}

/*
 * A reverse-DNS pass that COMPLETED — every address asked, the resolver
 * answering, most addresses without a PTR record. The default is the silent
 * case on purpose, so a test that expects a sentence has to name the flag that
 * earns it.
 */
function makeReverseDnsOutcome(
  overrides?: Partial<ReverseDnsNamingOutcome>,
): ReverseDnsNamingOutcome {
  return {
    resolvedCount: 1200,
    addressCount: 4000,
    namedAddressCount: 1200,
    notLookedUpAddressCount: 0,
    isTimeBudgetExhausted: false,
    isReverseDnsAvailable: true,
    totalBudgetInMs: 600000,
    ...overrides,
  };
}

// The same for NetBIOS: every eligible host asked, under the cap, in time.
function makeNetbiosOutcome(
  overrides?: Partial<NetbiosNamingOutcome>,
): NetbiosNamingOutcome {
  return {
    resolvedCount: 40,
    unnamedAddressCount: 1500,
    namedAddressCount: 40,
    eligibleAddressCount: 1500,
    queriedAddressCount: 1500,
    isHostCapReached: false,
    maxHosts: 2000,
    isTimeBudgetExhausted: false,
    totalBudgetInMs: 120000,
    ...overrides,
  };
}

function noteFor(
  reverseDnsOutcome: ReverseDnsNamingOutcome | undefined,
  netbiosOutcome?: NetbiosNamingOutcome | undefined,
  form: HostNamingNoteForm = "full",
): string {
  return buildHostNamingNote(
    makeResult({
      reverseDnsOutcome: reverseDnsOutcome,
      netbiosOutcome: netbiosOutcome,
    }),
    form,
  );
}

function compactNoteFor(
  reverseDnsOutcome: ReverseDnsNamingOutcome | undefined,
  netbiosOutcome?: NetbiosNamingOutcome | undefined,
): string {
  return noteFor(reverseDnsOutcome, netbiosOutcome, "compact");
}

/*
 * The same result as a scan() that never ran the naming passes would return —
 * including the global-probe NetBIOS skip (OneUptime issue #3916), which
 * scanWithDeadline stamps in place of a NetBIOS verdict and which is naming
 * news exactly as much as a verdict is.
 */
function withoutNamingOutcomes(result: SubnetScanResult): SubnetScanResult {
  const copy: SubnetScanResult = { ...result };
  delete copy.reverseDnsOutcome;
  delete copy.netbiosOutcome;
  delete copy.isNetbiosLookupSkippedOnGlobalProbe;
  return copy;
}

function countEllipses(text: string): number {
  return text.split("…").length - 1;
}

/*
 * The part of a clipped message between its essential sentences and its
 * compact note, after checking that both ends are exactly where they belong:
 * the essential sentences WHOLE at the start, the compact note WHOLE at the
 * end. `slice`, not `substring`: when the middle was dropped the start index
 * passes the end one, and substring would silently swap them and hand back the
 * separating space.
 */
function clippedMiddleOf(
  message: string,
  essential: string,
  compactNote: string,
): string {
  expect(message.startsWith(`${essential} `)).toBe(true);
  expect(message.endsWith(` ${compactNote}`)).toBe(true);

  return message.slice(
    essential.length + 1,
    message.length - compactNote.length - 1,
  );
}

/*
 * Text of an exact length cut from a realistic phrase, for steering a
 * sentence's length to the character. Not one repeated character, for the
 * reason VERBOSE_LABEL gives.
 */
function textOfLength(phrase: string, length: number): string {
  return phrase
    .repeat(Math.ceil(length / phrase.length) + 1)
    .substring(0, length);
}

/*
 * Ten credential sets with names long enough to crowd the credential summary
 * but each exactly AT the per-label cap, so none of them carries an ellipsis
 * of its own. That keeps "the message carries exactly one ellipsis" a real
 * assertion about the body clip rather than one satisfied by a cut label. Each
 * has its own community string, so the no-secret assertions have ten to find.
 */
function makeTenCrowdedConfigs(): Array<SubnetScanSnmpConfig> {
  const configs: Array<SubnetScanSnmpConfig> = [];

  for (let index: number = 0; index < 10; index++) {
    configs.push(
      makeSnmpConfig({
        id: `config-${index}`,
        label: `Distribution switches - building ${10 + index} (V1)`,
        communityString: `s3cret-community-${index}`,
      }),
    );
  }

  return configs;
}

// The four-credential estate the multi-credential tests above describe.
function makeFourEstateConfigs(): Array<SubnetScanSnmpConfig> {
  return [
    makeSnmpConfig({ id: "core", label: "Core switches (V3)" }),
    makeSnmpConfig({ id: "access", label: "Access switches (V2c)" }),
    makeSnmpConfig({ id: "printers", label: "Printers (V1)" }),
    makeSnmpConfig({ id: "vendor", label: "Vendor block (V2c)" }),
  ];
}

// A realistic 120-character quoted SNMP error — the scanner's own excerpt cap.
const LONG_SNMP_ERROR: string = (
  "Report PDU usmStatsUnknownEngineIDs from agent 10.20.30.40:161 during engine discovery; " +
  "the agent rejected the probe's security parameters"
).substring(0, 120);

/*
 * A deterministic pseudo-random source: the classic 32-bit linear congruential
 * generator (Numerical Recipes constants). Math.random would make the grid
 * below a different test on every run, and a failure it found once could not
 * be reproduced; a seeded LCG explores the same wide space every time. The
 * multiply stays exact in a double: 1664525 * (2^32 - 1) is under 2^53.
 */
function makeSeededRandom(seed: number): () => number {
  let state: number = seed % 4294967296;

  return (): number => {
    state = (1664525 * state + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function pickOne<T>(random: () => number, choices: Array<T>): T {
  return choices[Math.floor(random() * choices.length)]!;
}

/*
 * Every shape of outcome the note distinguishes, SAMPLED rather than crossed.
 *
 * The two halves of the note are built independently (see buildHostNamingNote:
 * a reverse-DNS sentence, a NetBIOS sentence, joined), and inside each half the
 * counts, the budget and the quoted reason are printed by different clauses of
 * the same sentence. Crossing every count against every budget against every
 * reason therefore buys repetitions of the same branches at a cost the file
 * pays on every run: the previous grids were 101 and 90 entries, and the
 * property test that crossed them took fifteen seconds to assert what a few
 * hundred pairs assert. Each row below is a shape the note really distinguishes;
 * the budgets and reasons are ZIPPED against the counts rather than crossed, so
 * every branch is still reached.
 *
 * No entry is tagged as an exception any more. The previous grid carried an
 * isCompactLongerThanFull flag for the two shapes whose compact sentence was
 * LONGER than its full one, and the property test skipped them; the compact
 * form now names a budget as "<b> limit" where the full form says "<b> time
 * limit", which is what made those two shorter. Any shape that is still longer
 * is a bug, and the property test names it rather than skipping it.
 */
interface GridEntry<T> {
  name: string;
  outcome: T | undefined;
}

function reverseDnsOutcomeGrid(): Array<GridEntry<ReverseDnsNamingOutcome>> {
  const grid: Array<GridEntry<ReverseDnsNamingOutcome>> = [
    { name: "no pass", outcome: undefined },
    { name: "complete", outcome: makeReverseDnsOutcome() },
    {
      // Healthy, and carrying a per-lookup reason that must not be reported.
      name: "complete with a stray reason",
      outcome: makeReverseDnsOutcome({ failureReason: BROKEN_RESOLVER_REASON }),
    },
  ];

  /*
   * One host (every singular), a four-thousand-host sweep (grouped counts) and
   * a twenty-thousand-host one (five digits in every clause).
   */
  const totals: Array<number> = [1, 4000, 20000];

  totals.forEach((total: number, index: number) => {
    const someNamed: number = total === 1 ? 0 : 1200;

    /*
     * A plain reason, one ending in the period quoteReason strips, one that is
     * nothing BUT periods, and one past the excerpt cap - one per total.
     */
    const reasons: Array<string> = [
      "resolver pool exhausted",
      "resolver pool exhausted.",
      "...",
      LONG_RESOLVER_ERROR,
    ];

    [0, someNamed].forEach((named: number, namedIndex: number) => {
      const reason: string =
        reasons[(index * 2 + namedIndex) % reasons.length]!;

      grid.push({
        name: `error ${total}/${named}/${reason.length}`,
        outcome: makeReverseDnsOutcome({
          resolvedCount: named,
          addressCount: total,
          namedAddressCount: named,
          error: reason,
        }),
      });
    });

    for (const reason of [
      undefined,
      ["queryPtr ESERVFAIL 10.in-addr.arpa.", LONG_RESOLVER_ERROR, "  ...  "][
        index
      ],
    ]) {
      grid.push({
        name: `unavailable ${total}/${String(reason)}`,
        outcome: makeReverseDnsOutcome({
          resolvedCount: 0,
          addressCount: total,
          namedAddressCount: 0,
          notLookedUpAddressCount: Math.max(0, total - 32),
          isReverseDnsAvailable: false,
          isTimeBudgetExhausted: true,
          failureReason: reason,
        }),
      });
    }

    /*
     * The budgets, zipped against what the pass has to say about the hosts it
     * never reached: unknown and not-a-number (no figure, advice kept), a plain
     * one, one a millisecond under the ceiling (advice kept), the ceiling
     * itself and one over it (advice dropped).
     */
    const budgets: Array<number | undefined> = [
      undefined,
      NaN,
      60000,
      1199999,
      1200000,
      1800000,
    ];
    const notLookedUpCounts: Array<number | undefined> = [
      undefined,
      0,
      1,
      total - someNamed,
      0,
      total - someNamed,
    ];

    budgets.forEach((budget: number | undefined, budgetIndex: number) => {
      const notLookedUp: number | undefined = notLookedUpCounts[budgetIndex];

      grid.push({
        name: `exhausted ${total}/${String(budget)}/${String(notLookedUp)}`,
        outcome: makeReverseDnsOutcome({
          resolvedCount: someNamed,
          addressCount: total,
          namedAddressCount: someNamed,
          notLookedUpAddressCount: notLookedUp,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: budget,
        }),
      });
    });

    /*
     * Lookups that failed (OneUptime issue #3916): some of
     * them beside names, every one of them with none, and alongside the time
     * limit — the one other sentence the failure sentence is ever printed
     * with. Every one of these reports something, so the silent entries stay
     * the three at the top.
     */
    grid.push({
      name: `failed ${total}/some`,
      outcome: makeReverseDnsOutcome({
        resolvedCount: someNamed,
        addressCount: total,
        namedAddressCount: someNamed,
        failedAddressCount: total === 1 ? 1 : 40,
      }),
    });
    grid.push({
      name: `failed ${total}/all`,
      outcome: makeReverseDnsOutcome({
        resolvedCount: 0,
        addressCount: total,
        namedAddressCount: 0,
        failedAddressCount: total,
      }),
    });
    grid.push({
      name: `exhausted-and-failed ${total}`,
      outcome: makeReverseDnsOutcome({
        resolvedCount: someNamed,
        addressCount: total,
        namedAddressCount: someNamed,
        notLookedUpAddressCount: Math.floor((total - someNamed) / 2),
        isTimeBudgetExhausted: true,
        totalBudgetInMs: [undefined, 60000, 1200000][index],
        failedAddressCount: Math.max(1, Math.floor(total / 10)),
      }),
    });
  });

  return grid;
}

function netbiosOutcomeGrid(): Array<GridEntry<NetbiosNamingOutcome>> {
  const grid: Array<GridEntry<NetbiosNamingOutcome>> = [
    { name: "no lookup", outcome: undefined },
    { name: "complete", outcome: makeNetbiosOutcome() },
    {
      // Every unnamed host refused by the address policy: nothing to confess.
      name: "nothing eligible",
      outcome: makeNetbiosOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        eligibleAddressCount: 0,
        queriedAddressCount: 0,
      }),
    },
  ];

  /*
   * One unnamed host, a sweep 1,500 over the default cap, and a /17's worth.
   * The under-cap shapes are covered by the sentence-by-sentence tests; what
   * the grid needs from the counts is the singular, the grouped thousands and
   * the cap arithmetic.
   */
  const unnamedCounts: Array<number> = [1, 3500, 18800];

  unnamedCounts.forEach((unnamed: number, index: number) => {
    const isOverCap: boolean = unnamed > 2000;
    const target: number = Math.min(unnamed, 2000);
    const named: number = Math.min(40, unnamed - 1);
    const shared: Partial<NetbiosNamingOutcome> = {
      resolvedCount: named,
      unnamedAddressCount: unnamed,
      namedAddressCount: named,
      eligibleAddressCount: unnamed,
      queriedAddressCount: target,
      isHostCapReached: isOverCap,
    };

    grid.push({
      name: `cap-without-counts ${unnamed}`,
      outcome: makeNetbiosOutcome({
        ...shared,
        isHostCapReached: true,
        eligibleAddressCount: undefined,
      }),
    });

    if (isOverCap) {
      /*
       * The cap with its counts, at the default and at the ceiling an operator
       * may raise it to - the two sides of the "(raise ...)" advice.
       */
      for (const maxHosts of [2000, NETBIOS_MAX_HOSTS_CEILING]) {
        grid.push({
          name: `cap ${unnamed}/${maxHosts}`,
          outcome: makeNetbiosOutcome({
            ...shared,
            isHostCapReached: true,
            maxHosts: maxHosts,
            queriedAddressCount: Math.min(unnamed, maxHosts),
          }),
        });
      }
    }

    for (const reason of [["boom.", "..."][index % 2]!, LONG_SOCKET_REASON]) {
      grid.push({
        name: `error ${unnamed}/${reason.length}`,
        outcome: makeNetbiosOutcome({ ...shared, error: reason }),
      });
    }

    /*
     * A socket that never bound, one that failed with nothing reported, and
     * one that failed partway.
     */
    const socketReasons: Array<string> = [
      BIND_TIMEOUT_REASON,
      LONG_SOCKET_REASON,
      "send ENETUNREACH",
    ];
    const socketQueried: Array<number | undefined> = [
      0,
      undefined,
      Math.floor(target / 2),
    ];

    socketReasons.forEach((reason: string, socketIndex: number) => {
      const queried: number | undefined = socketQueried[socketIndex];

      grid.push({
        name: `socket ${unnamed}/${reason.length}/${String(queried)}`,
        outcome: makeNetbiosOutcome({
          ...shared,
          resolvedCount: queried === 0 ? 0 : named,
          namedAddressCount: queried === 0 ? 0 : named,
          queriedAddressCount: queried,
          isTimeBudgetExhausted: queried === 0,
          failureReason: reason,
        }),
      });
    });

    /*
     * Out of time: an unknown budget, a short one and the automatic two
     * minutes, zipped against every host queried, one short of the target, and
     * a count the lookup did not report.
     */
    const budgets: Array<number | undefined> = [undefined, 30000, 120000, NaN];
    const queriedCounts: Array<number | undefined> = [
      target,
      target - 1,
      undefined,
      0,
    ];

    budgets.forEach((budget: number | undefined, budgetIndex: number) => {
      const queried: number | undefined = queriedCounts[budgetIndex];

      grid.push({
        name: `time ${unnamed}/${String(budget)}/${String(queried)}`,
        outcome: makeNetbiosOutcome({
          ...shared,
          /*
           * The time-limit sentence ALONE. Left beside the cap sentence it
           * would be measured with it, and the cap sentence's own "(raise
           * ...)" advice - a hundred characters the compact form drops - would
           * hide anything the time-limit sentence spends.
           */
          isHostCapReached: false,
          queriedAddressCount: queried,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: budget,
        }),
      });
    });

    if (isOverCap) {
      // And the two sentences together, which is what a big sweep really gets.
      grid.push({
        name: `cap-and-time ${unnamed}`,
        outcome: makeNetbiosOutcome({
          ...shared,
          isHostCapReached: true,
          queriedAddressCount: 1200,
          isTimeBudgetExhausted: true,
        }),
      });
    }
  });

  return grid;
}

describe("formatNamingBudget — a budget as an operator reads it", () => {
  /*
   * Undefined, not "0ms" or "NaNms": the caller leaves the figure out when
   * there is none, and "before its NaNms time limit" would make the one
   * sentence meant to explain unnamed hosts read as a probe bug.
   */
  test("says nothing for a budget that is missing or not a positive duration", () => {
    const values: Array<number | undefined> = [
      undefined,
      NaN,
      Infinity,
      -Infinity,
      0,
      -1,
      -60000,
    ];

    for (const value of values) {
      expect(formatNamingBudget(value)).toBeUndefined();
    }
  });

  test("a sub-second budget is printed in whole milliseconds", () => {
    expect(formatNamingBudget(1)).toBe("1ms");
    expect(formatNamingBudget(1.4)).toBe("1ms");
    expect(formatNamingBudget(250)).toBe("250ms");
    expect(formatNamingBudget(999)).toBe("999ms");
  });

  /*
   * Rounded to whole milliseconds BEFORE the unit is chosen. Checked the other
   * way round, 999.5ms is "under a second" and prints as "1000ms", a figure
   * nobody writes; and 0.4ms is a positive duration that rounds to a "0ms time
   * limit", which reads as a probe that set no limit at all.
   */
  test("rounds to whole milliseconds first, so 999.5ms reads 1s and a sub-half-millisecond budget is no figure", () => {
    expect(formatNamingBudget(999.5)).toBe("1s");
    expect(formatNamingBudget(999.5)).not.toBe("1000ms");
    expect(formatNamingBudget(999.4)).toBe("999ms");
    expect(formatNamingBudget(0.5)).toBe("1ms");
    expect(formatNamingBudget(0.4)).toBeUndefined();
    expect(formatNamingBudget(0.0001)).toBeUndefined();
    // Negative zero is zero, and -0.5 rounds to it.
    expect(formatNamingBudget(-0)).toBeUndefined();
    expect(formatNamingBudget(-0.5)).toBeUndefined();
  });

  test("a budget under a minute is printed in rounded seconds", () => {
    expect(formatNamingBudget(1000)).toBe("1s");
    expect(formatNamingBudget(1499)).toBe("1s");
    expect(formatNamingBudget(1500)).toBe("2s");
    // DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS, the NetBIOS floor.
    expect(formatNamingBudget(30000)).toBe("30s");
    expect(formatNamingBudget(59499)).toBe("59s");
  });

  /*
   * The rounding boundary. Seconds are rounded BEFORE the minute split, so
   * 59.5s must carry into "1m" — never "60s", which is a figure the docs and
   * the env var's defaults never use and an operator would not recognise as
   * the 60-second floor.
   */
  test("59.5 seconds rounds up into a whole minute rather than printing 60s", () => {
    expect(formatNamingBudget(59500)).toBe("1m");
    expect(formatNamingBudget(59500)).not.toBe("60s");
    // DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS, the reverse-DNS floor.
    expect(formatNamingBudget(60000)).toBe("1m");
  });

  test("minutes carry seconds only when there are any", () => {
    expect(formatNamingBudget(66000)).toBe("1m 6s");
    // MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS.
    expect(formatNamingBudget(120000)).toBe("2m");
    expect(formatNamingBudget(250000)).toBe("4m 10s");
    // MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS.
    expect(formatNamingBudget(600000)).toBe("10m");
    // The largest PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS Config accepts.
    expect(formatNamingBudget(1200000)).toBe("20m");
  });
});

describe("buildHostNamingNote — reverse DNS says nothing when it has nothing to confess", () => {
  test("no outcome at all (the pass did not run) gives an empty note", () => {
    expect(buildHostNamingNote(makeResult())).toBe("");
    expect(buildHostNamingNote(makeResult(), "compact")).toBe("");
    expect(noteFor(undefined)).toBe("");
  });

  /*
   * A sweep that found no hosts has no host to name, so even a pass that
   * reports every failure flag at once has nothing to qualify.
   */
  test("a pass over zero addresses gives an empty note whatever its flags say", () => {
    const outcome: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      resolvedCount: 0,
      addressCount: 0,
      namedAddressCount: 0,
      notLookedUpAddressCount: 0,
      isTimeBudgetExhausted: true,
      isReverseDnsAvailable: false,
      failureReason: "queryPtr ESERVFAIL",
      error: "boom",
    });

    expect(noteFor(outcome)).toBe("");
    expect(compactNoteFor(outcome)).toBe("");
  });

  /*
   * THE SILENCE THAT KEEPS THE NOTE WORTH READING. Most addresses on most
   * networks have no PTR record, so a pass that asked every address and named
   * few — or none — is healthy. A clause on every such scan would teach
   * operators to skip the one that matters.
   */
  test("a complete pass gives an empty note, however many hosts it named", () => {
    expect(noteFor(makeReverseDnsOutcome())).toBe("");
    expect(
      noteFor(
        makeReverseDnsOutcome({ resolvedCount: 0, namedAddressCount: 0 }),
      ),
    ).toBe("");
    expect(compactNoteFor(makeReverseDnsOutcome())).toBe("");
  });

  /*
   * A resolver reason on a pass that was NOT declared unavailable is a single
   * failed lookup among working ones. The scanner copies it onto the outcome
   * whatever the verdict, so the builder is what has to keep it off a healthy
   * scan's message.
   */
  test("a failure reason on a complete, available pass is not reported", () => {
    const outcome: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      failureReason: "queryPtr ETIMEOUT 10.0.0.5",
    });

    expect(noteFor(outcome)).toBe("");
    expect(compactNoteFor(outcome)).toBe("");
  });
});

describe("buildHostNamingNote — reverse DNS ran out of time", () => {
  test("says how many were named, the limit, how many were never asked, and the knob to turn", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toBe(EXHAUSTED_REVERSE_DNS_NOTE);
  });

  /*
   * en-US grouping on every count: "2700 of 15360" is readable, but the
   * scans list prints its own counts grouped, and a note that disagreed in
   * format would look like it came from somewhere else.
   */
  test("formats large counts and a budget with seconds", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        addressCount: 15360,
        namedAddressCount: 12345,
        notLookedUpAddressCount: 3015,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: 250000,
      }),
    );

    expect(note).toBe(
      "Reverse DNS named 12,345 of 15,360 hosts before its 4m 10s time limit; 3,015 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
    expect(note).toContain(REVERSE_DNS_BUDGET_ENV_VAR);
  });

  /*
   * A resolver double that reported no budget. The sentence drops the figure
   * rather than printing a wrong one — or "undefined".
   */
  test("an unknown budget reads 'before its time limit' with no figure", () => {
    const outcome: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      notLookedUpAddressCount: 2700,
      isTimeBudgetExhausted: true,
      totalBudgetInMs: undefined,
    });

    expect(noteFor(outcome)).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its time limit; 2,700 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
    expect(noteFor({ ...outcome, totalBudgetInMs: NaN })).toContain(
      "before its time limit;",
    );
  });

  /*
   * Unknown is a different statement from zero (see
   * ReverseDnsNamingOutcome.notLookedUpAddressCount), so the sentence must
   * not print "0 were never looked up" for it — nor a count it does not have.
   * And it says what those hosts lack, reverse DNS names, rather than how they
   * are listed: NetBIOS or an SNMP sysName may still have named them.
   */
  test("an unknown not-looked-up count says the unreached hosts got no reverse DNS name, without a number", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: undefined,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its 10m time limit; the hosts it did not reach got no reverse DNS name " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
  });

  /*
   * Every lookup had been started when time ran out — the last wave was
   * still in flight. Still worth saying (those in-flight hosts lost their
   * answers), but "0 were never looked up" would be noise.
   */
  test("zero never-looked-up hosts drops that clause but keeps the limit and the knob", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        notLookedUpAddressCount: 0,
        isTimeBudgetExhausted: true,
      }),
    );

    expect(note).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its 10m time limit " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
    expect(note).not.toContain("never looked up");
  });

  // Subject and verb agree: one host "was" never looked up.
  test("one never-looked-up host reads '1 was never looked up', and two read 'were'", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 1,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its 10m time limit; 1 was never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toContain("; 2 were never looked up (raise");
  });

  test("a one-host sweep reads '1 host', not '1 hosts'", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        resolvedCount: 0,
        addressCount: 1,
        namedAddressCount: 0,
        notLookedUpAddressCount: 0,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: 60000,
      }),
    );

    expect(note).toContain(
      "Reverse DNS named 0 of 1 host before its 1m time limit",
    );
    expect(note).not.toContain("1 hosts");
  });

  /*
   * A double that claimed more names than addresses must not produce "named
   * 5,000 of 4,000 hosts" — and a missing named count must read as zero, not
   * as NaN.
   */
  test("the named count is clamped to the address count and a missing one reads as zero", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          namedAddressCount: 5000,
          notLookedUpAddressCount: 0,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toContain("named 4,000 of 4,000 hosts");

    const note: string = noteFor(
      makeReverseDnsOutcome({
        namedAddressCount: NaN,
        notLookedUpAddressCount: NaN,
        isTimeBudgetExhausted: true,
      }),
    );

    expect(note).toContain("Reverse DNS named 0 of 4,000 hosts");
    expect(note).not.toContain("NaN");
  });
});

describe("buildHostNamingNote — the raise-the-budget advice stops at the ceiling", () => {
  /*
   * Past REVERSE_DNS_BUDGET_OVERRIDE_CEILING_IN_MS Config ignores the variable
   * and sizes the budget AUTOMATICALLY, at most ten minutes. An operator whose
   * pass already ran under a twenty-minute budget and who follows "raise
   * PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS" would CUT their budget in half.
   */
  test("the mirrored ceiling is the one Config enforces", () => {
    expect(MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS).toBe(
      REVERSE_DNS_BUDGET_OVERRIDE_CEILING_IN_MS,
    );
    expect(REVERSE_DNS_BUDGET_OVERRIDE_CEILING_IN_MS).toBe(1200000);
  });

  test("advice is kept one millisecond under the ceiling and dropped at exactly the ceiling", () => {
    const makeOutcome: (
      budget: number | undefined,
    ) => ReverseDnsNamingOutcome = (
      budget: number | undefined,
    ): ReverseDnsNamingOutcome => {
      return makeReverseDnsOutcome({
        notLookedUpAddressCount: 2700,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: budget,
      });
    };

    // 1,199,999ms rounds to 20m for display, but it is under the ceiling.
    expect(noteFor(makeOutcome(1199999))).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its 20m time limit; 2,700 were never looked up " +
        "(raise PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS on the probe to allow longer).",
    );

    // The sentence still ends cleanly: one period, no dangling space.
    expect(noteFor(makeOutcome(1200000))).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its 20m time limit; 2,700 were never looked up.",
    );

    for (const overCeiling of [1200001, 1800000, 3600000]) {
      const note: string = noteFor(makeOutcome(overCeiling));

      expect(note).not.toContain(REVERSE_DNS_BUDGET_ENV_VAR);
      expect(note).not.toContain("raise");
      expect(note.endsWith("; 2,700 were never looked up.")).toBe(true);
    }
  });

  /*
   * A resolver that did not report its budget could have run under anything,
   * including the automatic default the variable exists to raise. Withholding
   * the advice there would hide the one fix that usually applies.
   */
  test("advice is kept when the budget is unknown", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: undefined,
        }),
      ),
    ).toContain(
      `(raise ${REVERSE_DNS_BUDGET_ENV_VAR} on the probe to allow longer).`,
    );
  });

  /*
   * A budget that is not a number at all is not a budget at or over the
   * ceiling: every comparison against NaN is false, and reading one as "this
   * pass already ran for twenty minutes" would withhold the advice from a
   * pass that may have run for sixty seconds. The figure is left out of the
   * sentence — there is none to print — and the advice stays.
   */
  test("advice is kept when the budget is not a number, and no figure is printed", () => {
    for (const budget of [NaN, -Infinity, 0, -1]) {
      const note: string = noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: budget,
        }),
      );

      expect(note).toBe(
        "Reverse DNS named 1,200 of 4,000 hosts before its time limit; 2,700 were never looked up " +
          `(raise ${REVERSE_DNS_BUDGET_ENV_VAR} on the probe to allow longer).`,
      );
      expect(note).not.toContain("NaN");
      expect(note).not.toContain("Infinity");
    }
  });

  /*
   * An INFINITE budget is the one non-number that is genuinely at the ceiling:
   * it compares at or over every value, so there is nothing left to raise, and
   * the sentence ends without the advice — and without a figure, because
   * "before its Infinityms time limit" is not a duration anyone ran for.
   */
  test("an infinite budget drops the advice and prints no figure", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: Infinity,
        }),
      ),
    ).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its time limit; 2,700 were never looked up.",
    );
  });

  test("at the ceiling, the zero and the unknown not-looked-up forms also end without advice", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 0,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 1200000,
        }),
      ),
    ).toBe("Reverse DNS named 1,200 of 4,000 hosts before its 20m time limit.");
    expect(
      noteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: undefined,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 1200000,
        }),
      ),
    ).toBe(
      "Reverse DNS named 1,200 of 4,000 hosts before its 20m time limit; the hosts it did not reach got no reverse DNS name.",
    );
  });

  // The compact form never carries the advice, whatever the budget.
  test("the compact form carries no advice on either side of the ceiling", () => {
    for (const budget of [undefined, 60000, 1199999, 1200000, 1800000]) {
      const note: string = compactNoteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: budget,
        }),
      );

      expect(note).not.toContain(REVERSE_DNS_BUDGET_ENV_VAR);
      expect(note).not.toContain("raise");
    }
  });
});

describe("buildHostNamingNote — reverse DNS got no answers", () => {
  test("says no host got a reverse DNS name and names both places to look", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          resolvedCount: 0,
          namedAddressCount: 0,
          isReverseDnsAvailable: false,
        }),
      ),
    ).toBe(UNAVAILABLE_REVERSE_DNS_NOTE);
  });

  /*
   * An unusable resolver also exhausts nothing useful: more time would not
   * have named a single host, so "raise the budget" is the wrong advice and
   * must not appear even though the resolver skipped the rest of the pass.
   */
  test("beats the time-limit wording, and never names the budget env var", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        notLookedUpAddressCount: 3968,
        isReverseDnsAvailable: false,
        isTimeBudgetExhausted: true,
      }),
    );

    expect(note).toBe(UNAVAILABLE_REVERSE_DNS_NOTE);
    expect(note).not.toContain(REVERSE_DNS_BUDGET_ENV_VAR);
    expect(note).not.toContain("time limit");
  });

  test("a one-host sweep reads 'the one host got no reverse DNS name'", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          resolvedCount: 0,
          addressCount: 1,
          namedAddressCount: 0,
          isReverseDnsAvailable: false,
        }),
      ),
    ).toBe(
      "Reverse DNS lookups from this probe got no answers, so the one host got no reverse DNS name - " +
        "check the probe's DNS resolver and the reverse DNS zone for this range.",
    );
  });

  /*
   * The reason is what tells a broken probe resolver (ECONNREFUSED) from a
   * reverse zone delegated to a dead nameserver (ESERVFAIL), so it is quoted —
   * trimmed, and without the trailing period that would print as "arpa.),".
   */
  test("quotes the resolver's failure reason, trimmed and with its trailing period stripped", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        isReverseDnsAvailable: false,
        failureReason: "  queryPtr ESERVFAIL 10.in-addr.arpa. ",
      }),
    );

    expect(note).toBe(
      "Reverse DNS lookups from this probe got no answers (queryPtr ESERVFAIL 10.in-addr.arpa), " +
        "so none of the 4,000 hosts got a reverse DNS name - check the probe's DNS resolver and the reverse DNS zone for this range.",
    );
    expect(note).not.toContain(".)");
  });

  /*
   * A reason that is nothing but punctuation and space used to strip to
   * nothing and print as an empty pair of parentheses. It now keeps its
   * trimmed self: "(... .)" says as little as the resolver did, but it reads
   * as a resolver nobody can quote rather than as a probe that lost the text.
   * See the quoteReason describe below for the shape of that promise.
   */
  test("a reason of nothing but periods is still quoted, never as '()'", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        isReverseDnsAvailable: false,
        failureReason: " ... . ",
      }),
    );

    expect(note).toBe(
      "Reverse DNS lookups from this probe got no answers (... .), " +
        "so none of the 4,000 hosts got a reverse DNS name - check the probe's DNS resolver and the reverse DNS zone for this range.",
    );
    expect(note).not.toContain("()");
  });

  test("a long failure reason is quoted cut to exactly the excerpt cap", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        isReverseDnsAvailable: false,
        failureReason: LONG_RESOLVER_ERROR,
      }),
    );

    const quoted: RegExpMatchArray | null = note.match(
      /^Reverse DNS lookups from this probe got no answers \((.+)\), so none of the 4,000 hosts got a reverse DNS name - /,
    );

    expect(quoted).not.toBeNull();
    expect(quoted![1]!.length).toBe(MAX_NAMING_REASON_EXCERPT_LENGTH);
    expect(quoted![1]!.endsWith("…")).toBe(true);
    expect(LONG_RESOLVER_ERROR.startsWith(quoted![1]!.slice(0, -1))).toBe(true);
  });

  /*
   * The resolver guarantees "unavailable" only with zero names. A double
   * that reports both must not make the message claim NO host was named
   * when some plainly were: it falls through to whatever else is true.
   */
  test("an 'unavailable' verdict with names falls through to the time limit, or to silence", () => {
    const namedButUnavailable: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      namedAddressCount: 1200,
      isReverseDnsAvailable: false,
      failureReason: BROKEN_RESOLVER_REASON,
    });

    expect(noteFor(namedButUnavailable)).toBe("");

    const note: string = noteFor({
      ...namedButUnavailable,
      notLookedUpAddressCount: 2700,
      isTimeBudgetExhausted: true,
    });

    expect(note).toBe(EXHAUSTED_REVERSE_DNS_NOTE);
    expect(note).not.toContain("got no answers");
    expect(note).not.toContain(BROKEN_RESOLVER_REASON);
  });
});

describe("buildHostNamingNote — the reverse-DNS pass threw", () => {
  test("says how many were named before the failure and quotes it", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          namedAddressCount: 12,
          error: "resolver pool exhausted",
        }),
      ),
    ).toBe(
      "Reverse DNS lookups failed on this probe (resolver pool exhausted) after naming 12 of 4,000 hosts.",
    );
  });

  test("says none of the hosts got a reverse DNS name when nothing was named", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          namedAddressCount: 0,
          error: "resolver pool exhausted",
        }),
      ),
    ).toBe(
      "Reverse DNS lookups failed on this probe (resolver pool exhausted), so none of the 4,000 hosts got a reverse DNS name.",
    );
  });

  test("a one-host sweep reads ', so the one host got no reverse DNS name'", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          addressCount: 1,
          namedAddressCount: 0,
          error: "unknown error",
        }),
      ),
    ).toBe(
      "Reverse DNS lookups failed on this probe (unknown error), so the one host got no reverse DNS name.",
    );
  });

  test("a quoted error loses its trailing period and surrounding space", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        namedAddressCount: 12,
        error: " resolver pool exhausted.  ",
      }),
    );

    expect(note).toBe(
      "Reverse DNS lookups failed on this probe (resolver pool exhausted) after naming 12 of 4,000 hosts.",
    );
  });

  /*
   * A throw is the most fundamental of the three: the flags beside it describe
   * a pass that did not finish reporting, so neither "no answers" nor "raise
   * the budget" can be trusted as the diagnosis.
   */
  test("beats both the unavailable and the time-limit wording", () => {
    const note: string = noteFor(
      makeReverseDnsOutcome({
        namedAddressCount: 0,
        isReverseDnsAvailable: false,
        isTimeBudgetExhausted: true,
        notLookedUpAddressCount: 4000,
        failureReason: BROKEN_RESOLVER_REASON,
        error: "boom",
      }),
    );

    expect(
      note.startsWith("Reverse DNS lookups failed on this probe (boom)"),
    ).toBe(true);
    expect(note).not.toContain("got no answers");
    expect(note).not.toContain("time limit");
    expect(note).not.toContain(BROKEN_RESOLVER_REASON);
  });

  /*
   * The quoted error is bounded so an exception message cannot eat the column.
   * Pulled back out of the sentence rather than recomputed, for the reason
   * the credential-label tests give.
   */
  test("a long error is quoted cut to exactly the excerpt cap, ellipsis included", () => {
    expect(LONG_RESOLVER_ERROR.length).toBeGreaterThan(
      MAX_NAMING_REASON_EXCERPT_LENGTH,
    );

    const note: string = noteFor(
      makeReverseDnsOutcome({
        namedAddressCount: 0,
        error: LONG_RESOLVER_ERROR,
      }),
    );

    const quoted: RegExpMatchArray | null = note.match(
      /^Reverse DNS lookups failed on this probe \((.+)\), so none of the 4,000 hosts got a reverse DNS name\.$/,
    );

    expect(quoted).not.toBeNull();

    const excerpt: string = quoted![1]!;

    expect(excerpt.length).toBe(MAX_NAMING_REASON_EXCERPT_LENGTH);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(LONG_RESOLVER_ERROR.startsWith(excerpt.slice(0, -1))).toBe(true);
    expect(note).not.toContain(LONG_RESOLVER_ERROR);
  });

  test("an error exactly at the excerpt cap is quoted whole", () => {
    const atCap: string = LONG_RESOLVER_ERROR.substring(
      0,
      MAX_NAMING_REASON_EXCERPT_LENGTH,
    );

    const note: string = noteFor(
      makeReverseDnsOutcome({ namedAddressCount: 0, error: atCap }),
    );

    expect(note).toContain(`(${atCap})`);
    expect(note).not.toContain("…");
  });

  /*
   * The period is stripped BEFORE the excerpt is taken. An 81-character error
   * whose 81st character is its full stop fits the cap once stripped, and must
   * not lose its last real character to an ellipsis.
   */
  test("an error one period over the cap is quoted whole once the period is stripped", () => {
    const atCap: string = LONG_RESOLVER_ERROR.substring(
      0,
      MAX_NAMING_REASON_EXCERPT_LENGTH,
    );

    expect(atCap.endsWith(".") || atCap.endsWith(" ")).toBe(false);

    const note: string = noteFor(
      makeReverseDnsOutcome({ namedAddressCount: 0, error: `${atCap}.` }),
    );

    expect(note).toContain(`(${atCap}),`);
    expect(note).not.toContain("…");
  });
});

/*
 * quoteReason (FetchScans.ts), through the four sentences that quote one.
 *
 * The trailing period is stripped because it would double the punctuation of
 * the sentence around it — "(The UDP socket did not bind in time.)." — but
 * stripping must never empty the quote. "(...)" is a reason nobody can act on;
 * "()" reads as a probe that lost the text, and the operator cannot tell which
 * of the two they are looking at. So a reason that strips to nothing keeps its
 * trimmed self, and one that has nothing to keep says so in words.
 */
describe("buildHostNamingNote — a reason that is nothing but punctuation", () => {
  test("a reason of periods is quoted as its trimmed self on every sentence that quotes one", () => {
    for (const reason of [".", "...", "  ...  "]) {
      const quoted: string = reason.trim();

      expect(
        noteFor(makeReverseDnsOutcome({ namedAddressCount: 0, error: reason })),
      ).toBe(
        `Reverse DNS lookups failed on this probe (${quoted}), so none of the 4,000 hosts got a reverse DNS name.`,
      );
      expect(compactNoteFor(makeReverseDnsOutcome({ error: reason }))).toBe(
        `Reverse DNS failed (${quoted}).`,
      );
      expect(
        noteFor(
          makeReverseDnsOutcome({
            resolvedCount: 0,
            namedAddressCount: 0,
            isReverseDnsAvailable: false,
            failureReason: reason,
          }),
        ),
      ).toContain(`got no answers (${quoted}),`);
      expect(noteFor(undefined, makeNetbiosOutcome({ error: reason }))).toBe(
        `NetBIOS lookups failed on this probe (${quoted}).`,
      );
      expect(
        compactNoteFor(
          undefined,
          makeNetbiosOutcome({
            resolvedCount: 0,
            namedAddressCount: 0,
            queriedAddressCount: 0,
            failureReason: reason,
          }),
        ),
      ).toBe(`NetBIOS socket failed (${quoted}).`);
    }
  });

  /*
   * A reason of nothing but whitespace cannot reach the note through the
   * scanner — SubnetScanner.readReason returns undefined for one, and
   * describeEnrichmentError turns a blank throw into "unknown error" — so this
   * is the outcome a test double, or a future resolver that reports its own
   * reasons, would hand the builder. It must still read as a reason.
   */
  test("a reason that is only whitespace reads 'unknown error', never '()'", () => {
    for (const reason of [" ", "   ", "\t \n"]) {
      const thrown: string = noteFor(
        undefined,
        makeNetbiosOutcome({ error: reason }),
      );

      expect(thrown).toBe(
        "NetBIOS lookups failed on this probe (unknown error).",
      );
      expect(thrown).not.toContain("()");
      expect(
        compactNoteFor(
          makeReverseDnsOutcome({
            resolvedCount: 0,
            namedAddressCount: 0,
            isReverseDnsAvailable: false,
            failureReason: reason,
          }),
        ),
      ).toBe("Reverse DNS got no answers (unknown error).");
    }
  });

  /*
   * An EMPTY reason is not a reason at all: the sentence that quotes one is
   * not reached, rather than reached with "unknown error" in its parentheses.
   */
  test("an empty reason leaves the failure sentence out altogether", () => {
    expect(noteFor(undefined, makeNetbiosOutcome({ error: "" }))).toBe("");
    expect(
      noteFor(makeReverseDnsOutcome({ namedAddressCount: 0, error: "" })),
    ).toBe("");
  });

  // Over every shape either grid produces, in either form: no empty parentheses.
  test("no outcome in either grid prints an empty pair of parentheses", () => {
    for (const form of ["full", "compact"] as Array<HostNamingNoteForm>) {
      for (const reverseDns of reverseDnsOutcomeGrid()) {
        expect(noteFor(reverseDns.outcome, undefined, form)).not.toContain(
          "()",
        );
      }

      for (const netbios of netbiosOutcomeGrid()) {
        expect(noteFor(undefined, netbios.outcome, form)).not.toContain("()");
      }
    }
  });
});

describe("buildHostNamingNote — no reverse-DNS sentence claims hosts are listed by IP address", () => {
  /*
   * A host reverse DNS could not name may still be named by its SNMP sysName,
   * or by NetBIOS, which runs afterwards precisely for those hosts. "Listed by
   * IP address" was false exactly when the other sources did their job, so it
   * must not come back in any branch, in either form.
   */
  test("no outcome in the grid, full or compact, alone or on a message, says 'listed by IP address'", () => {
    const reverseDnsGrid: Array<GridEntry<ReverseDnsNamingOutcome>> =
      reverseDnsOutcomeGrid();
    const netbiosGrid: Array<GridEntry<NetbiosNamingOutcome>> =
      netbiosOutcomeGrid();
    let reportingOutcomes: number = 0;

    for (const reverseDns of reverseDnsGrid) {
      for (const form of ["full", "compact"] as Array<HostNamingNoteForm>) {
        const note: string = noteFor(reverseDns.outcome, undefined, form);

        if (note) {
          reportingOutcomes++;
        }

        expect(note).not.toContain("listed by IP address");
        expect(note).not.toContain("listed by address");
      }

      for (const netbios of [netbiosGrid[0]!, netbiosGrid[3]!]) {
        const outcomes: Partial<SubnetScanResult> = {
          reverseDnsOutcome: reverseDns.outcome,
          netbiosOutcome: netbios.outcome,
        };

        expect(
          buildScanStatusMessage(
            makeResult({ respondedToPingCount: 12, ...outcomes }),
            3,
          ),
        ).not.toContain("listed by IP address");
        expect(
          buildScanStatusMessage(makeIcmpOnlyResult({ ...outcomes }), 0),
        ).not.toContain("listed by IP address");
      }
    }

    /*
     * Guard on the guard: the grid really does reach the sentences in
     * question. Every entry but the three silent ones reports something, in
     * each of the two forms.
     */
    expect(reportingOutcomes).toBe((reverseDnsGrid.length - 3) * 2);
    expect(reportingOutcomes).toBeGreaterThan(40);

    for (const netbios of netbiosGrid) {
      expect(noteFor(undefined, netbios.outcome)).not.toContain(
        "listed by IP address",
      );
      expect(compactNoteFor(undefined, netbios.outcome)).not.toContain(
        "listed by IP address",
      );
    }
  });
});

describe("buildHostNamingNote — NetBIOS says nothing when it has nothing to confess", () => {
  test("no outcome, or no unnamed host, gives an empty note whatever the flags say", () => {
    const flagsWithNothingToName: NetbiosNamingOutcome = makeNetbiosOutcome({
      resolvedCount: 0,
      unnamedAddressCount: 0,
      namedAddressCount: 0,
      isHostCapReached: true,
      isTimeBudgetExhausted: true,
      failureReason: "bind timed out",
      error: "boom",
    });

    expect(noteFor(undefined, undefined)).toBe("");
    expect(noteFor(undefined, flagsWithNothingToName)).toBe("");
    expect(compactNoteFor(undefined, flagsWithNothingToName)).toBe("");
  });

  test("a complete lookup gives an empty note, however few hosts answered", () => {
    expect(noteFor(undefined, makeNetbiosOutcome())).toBe("");
    expect(compactNoteFor(undefined, makeNetbiosOutcome())).toBe("");
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({ resolvedCount: 0, namedAddressCount: 0 }),
      ),
    ).toBe("");
  });

  /*
   * Public addresses are refused by policy, not cut short. A sweep of a
   * routable range leaves every host unnamed and eligible for nothing, and
   * that is the lookup working as designed.
   */
  test("hosts refused by the address policy are not reported", () => {
    const refused: NetbiosNamingOutcome = makeNetbiosOutcome({
      resolvedCount: 0,
      namedAddressCount: 0,
      eligibleAddressCount: 0,
      queriedAddressCount: 0,
    });

    expect(noteFor(undefined, refused)).toBe("");
    expect(compactNoteFor(undefined, refused)).toBe("");
  });
});

describe("buildHostNamingNote — NetBIOS reached its host cap", () => {
  /*
   * The cap is an operator-settable number now (PROBE_DISCOVERY_NETBIOS_MAX_HOSTS),
   * so the sentence that reports it also names the knob — the cap is otherwise
   * the one limit in this note the operator cannot find from the message.
   */
  test("names the cap, how many unnamed hosts were left out, and the knob to turn", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          queriedAddressCount: 2000,
          isHostCapReached: true,
        }),
      ),
    ).toBe(NETBIOS_CAP_NOTE);
  });

  test("one host over the cap reads '1 unnamed host was not asked', advice and all", () => {
    const note: string = noteFor(
      undefined,
      makeNetbiosOutcome({
        unnamedAddressCount: 2001,
        eligibleAddressCount: 2001,
        queriedAddressCount: 2000,
        isHostCapReached: true,
      }),
    );

    expect(note).toBe(
      "NetBIOS lookups are capped at 2,000 hosts per scan, so 1 unnamed host was not asked " +
        `(raise ${NETBIOS_MAX_HOSTS_ENV_VAR} on the probe to ask more).`,
    );
  });

  /*
   * A resolution that set the flag without the counts. The sentence still
   * says the cap bit — the operator needs to know some hosts were never asked
   * — but invents no number for it.
   */
  test("without the counts, says the cap was reached in general terms", () => {
    const generic: string =
      "NetBIOS lookups reached their per-scan host cap, so some unnamed hosts were not asked.";

    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: undefined,
          isHostCapReached: true,
        }),
      ),
    ).toBe(generic);
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          maxHosts: undefined,
          isHostCapReached: true,
        }),
      ),
    ).toBe(generic);
  });

  /*
   * The sentence with no cap to name cannot tell the operator to raise it:
   * without the counts there is no number to raise FROM, and the advice would
   * be the only actionable half of a sentence that knows nothing.
   */
  test("the general form carries no advice, because it names no cap", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: undefined,
          isHostCapReached: true,
        }),
      ),
    ).not.toContain(NETBIOS_MAX_HOSTS_ENV_VAR);
  });
});

/*
 * PROBE_DISCOVERY_NETBIOS_MAX_HOSTS can raise the cap to
 * MAX_NETBIOS_MAX_HOSTS_OVERRIDE and no further: past it the lookup would be
 * cut off by its clock instead of by the cap, which is the silent truncation
 * the cap exists to make visible. A lookup already running AT that ceiling has
 * nothing to raise, so the advice has to stop exactly there — the same promise
 * the reverse-DNS budget advice makes about its own ceiling.
 */
describe("buildHostNamingNote — the raise-the-cap advice stops at the ceiling", () => {
  function capNoteFor(maxHosts: number): string {
    return noteFor(
      undefined,
      makeNetbiosOutcome({
        unnamedAddressCount: maxHosts + 1500,
        eligibleAddressCount: maxHosts + 1500,
        queriedAddressCount: maxHosts,
        maxHosts: maxHosts,
        isHostCapReached: true,
      }),
    );
  }

  test("the mirrored ceiling is the one Config enforces", () => {
    expect(MAX_NETBIOS_MAX_HOSTS_OVERRIDE).toBe(NETBIOS_MAX_HOSTS_CEILING);
    expect(NETBIOS_MAX_HOSTS_CEILING).toBe(4000);
  });

  test("advice is kept below the ceiling, including one host under it", () => {
    for (const maxHosts of [500, 2000, NETBIOS_MAX_HOSTS_CEILING - 1]) {
      const note: string = capNoteFor(maxHosts);

      expect(note).toBe(
        `NetBIOS lookups are capped at ${maxHosts.toLocaleString("en-US")} hosts per scan, ` +
          `so 1,500 unnamed hosts were not asked (raise ${NETBIOS_MAX_HOSTS_ENV_VAR} on the probe to ask more).`,
      );
    }
  });

  /*
   * At the ceiling and above, the sentence ends cleanly instead: one period,
   * no dangling space, and no advice to set a variable that would be ignored.
   */
  test("advice is dropped at exactly the ceiling and above it", () => {
    for (const maxHosts of [
      NETBIOS_MAX_HOSTS_CEILING,
      NETBIOS_MAX_HOSTS_CEILING + 1,
      8000,
    ]) {
      const note: string = capNoteFor(maxHosts);

      expect(note).toBe(
        `NetBIOS lookups are capped at ${maxHosts.toLocaleString("en-US")} hosts per scan, ` +
          "so 1,500 unnamed hosts were not asked.",
      );
      expect(note).not.toContain(NETBIOS_MAX_HOSTS_ENV_VAR);
      expect(note).not.toContain("raise");
    }
  });

  /*
   * The compact cap sentence is unchanged: it never carried advice, and does
   * not start now, on either side of the ceiling.
   */
  test("the compact cap sentence carries no advice, whatever the cap", () => {
    for (const maxHosts of [
      500,
      2000,
      NETBIOS_MAX_HOSTS_CEILING - 1,
      NETBIOS_MAX_HOSTS_CEILING,
      8000,
    ]) {
      const compact: string = compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: maxHosts + 1500,
          eligibleAddressCount: maxHosts + 1500,
          queriedAddressCount: maxHosts,
          maxHosts: maxHosts,
          isHostCapReached: true,
        }),
      );

      expect(compact).toBe(
        `NetBIOS skipped 1,500 hosts over its ${maxHosts.toLocaleString("en-US")}-host cap.`,
      );
      expect(compact).not.toContain(NETBIOS_MAX_HOSTS_ENV_VAR);
      expect(compact).not.toContain("raise");
    }
  });

  /*
   * The singular, with the advice attached: the two are built by the same
   * expression, and a sentence that reads "1 unnamed host were not asked
   * (raise ...)" is the kind of thing only a test looking at both catches.
   */
  test("one host left out, one host under the ceiling, reads 'was' and still advises", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: NETBIOS_MAX_HOSTS_CEILING,
          eligibleAddressCount: NETBIOS_MAX_HOSTS_CEILING,
          queriedAddressCount: NETBIOS_MAX_HOSTS_CEILING - 1,
          maxHosts: NETBIOS_MAX_HOSTS_CEILING - 1,
          isHostCapReached: true,
        }),
      ),
    ).toBe(
      "NetBIOS lookups are capped at 3,999 hosts per scan, so 1 unnamed host was not asked " +
        `(raise ${NETBIOS_MAX_HOSTS_ENV_VAR} on the probe to ask more).`,
    );

    // And at the ceiling, the singular ends with its own period.
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: NETBIOS_MAX_HOSTS_CEILING + 1,
          eligibleAddressCount: NETBIOS_MAX_HOSTS_CEILING + 1,
          queriedAddressCount: NETBIOS_MAX_HOSTS_CEILING,
          maxHosts: NETBIOS_MAX_HOSTS_CEILING,
          isHostCapReached: true,
        }),
      ),
    ).toBe(
      "NetBIOS lookups are capped at 4,000 hosts per scan, so 1 unnamed host was not asked.",
    );
  });

  /*
   * The advice rides on the message the operator actually reads, not only on
   * the note in isolation — and never on the compact form the message falls
   * back to when the full sentences do not fit.
   */
  test("the message carries the advice with the full note and drops it with the compact one", () => {
    const result: SubnetScanResult = makeResult({
      respondedToPingCount: 12,
      netbiosOutcome: makeNetbiosOutcome({
        unnamedAddressCount: 3500,
        eligibleAddressCount: 3500,
        queriedAddressCount: 2000,
        isHostCapReached: true,
      }),
    });

    expect(buildScanStatusMessage(result, 3)).toBe(
      `${snmpHeadline(254, 12, 3)} ${NETBIOS_CAP_NOTE}`,
    );
    expect(buildHostNamingNote(result, "compact")).toBe(
      NETBIOS_CAP_COMPACT_NOTE,
    );
    expect(buildHostNamingNote(result, "compact")).not.toContain(
      NETBIOS_MAX_HOSTS_ENV_VAR,
    );
  });
});

describe("buildHostNamingNote — NetBIOS without a usable socket", () => {
  /*
   * A socket that never bound ALSO reports the budget as spent (the bind wait
   * is charged to it), and "time limit" would send the operator to a budget
   * that more of would not help. The socket is the diagnosis — and since not
   * one query went out, the lookups did not STOP, they never ran.
   */
  test("a socket failure beats the time-limit wording that a bind timeout also sets", () => {
    const note: string = noteFor(
      undefined,
      makeNetbiosOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        queriedAddressCount: 0,
        isTimeBudgetExhausted: true,
        failureReason: "bind timed out",
      }),
    );

    expect(note).toBe(
      "NetBIOS lookups did not run because the probe's UDP socket failed (bind timed out).",
    );
    expect(note).not.toContain("time limit");
    expect(note).not.toContain("stopped");
  });

  /*
   * The resolver's own bind-timeout reason, verbatim. Its full stop is
   * stripped inside the parentheses, so the sentence ends "time)." and not
   * "time.).".
   */
  test("the real bind-timeout reason reads 'did not run' when nothing was queried, with one period", () => {
    const note: string = noteFor(
      undefined,
      makeNetbiosOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        queriedAddressCount: 0,
        isTimeBudgetExhausted: true,
        failureReason: BIND_TIMEOUT_REASON,
      }),
    );

    expect(note).toBe(
      "NetBIOS lookups did not run because the probe's UDP socket failed (The UDP socket did not bind in time).",
    );
    expect(note).not.toContain(".)");
  });

  /*
   * Unknown is not zero. A resolution that did not report how many hosts it
   * queried may have sent thousands before the socket failed, so "did not
   * run" would be a claim the probe cannot back; the sentence keeps "stopped".
   */
  test("an unknown queried count reads 'stopped', never 'did not run'", () => {
    const outcome: NetbiosNamingOutcome = makeNetbiosOutcome({
      resolvedCount: 0,
      namedAddressCount: 0,
      queriedAddressCount: undefined,
      failureReason: BIND_TIMEOUT_REASON,
    });

    expect(noteFor(undefined, outcome)).toBe(
      "NetBIOS lookups stopped because the probe's UDP socket failed (The UDP socket did not bind in time).",
    );
    expect(
      noteFor(undefined, {
        ...outcome,
        resolvedCount: 2,
        namedAddressCount: 2,
      }),
    ).toBe(
      "NetBIOS lookups stopped because the probe's UDP socket failed (The UDP socket did not bind in time) after naming 2 hosts.",
    );
  });

  test("a socket that failed partway says how many hosts it named first", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          resolvedCount: 3,
          namedAddressCount: 3,
          failureReason: "send ENETUNREACH",
        }),
      ),
    ).toBe(
      "NetBIOS lookups stopped because the probe's UDP socket failed (send ENETUNREACH) after naming 3 hosts.",
    );
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          resolvedCount: 1,
          namedAddressCount: 1,
          failureReason: "send ENETUNREACH",
        }),
      ),
    ).toBe(
      "NetBIOS lookups stopped because the probe's UDP socket failed (send ENETUNREACH) after naming 1 host.",
    );
  });

  test("a long socket failure reason is quoted cut to exactly the excerpt cap", () => {
    expect(LONG_SOCKET_REASON.length).toBeGreaterThan(
      MAX_NAMING_REASON_EXCERPT_LENGTH,
    );

    const note: string = noteFor(
      undefined,
      makeNetbiosOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        failureReason: LONG_SOCKET_REASON,
      }),
    );

    const quoted: RegExpMatchArray | null = note.match(
      /^NetBIOS lookups stopped because the probe's UDP socket failed \((.+)\)\.$/,
    );

    expect(quoted).not.toBeNull();

    const excerpt: string = quoted![1]!;

    expect(excerpt.length).toBe(MAX_NAMING_REASON_EXCERPT_LENGTH);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(LONG_SOCKET_REASON.startsWith(excerpt.slice(0, -1))).toBe(true);
  });

  /*
   * A throw out of the lookup outranks what the flags beside it say, for the
   * reason given on the reverse-DNS side.
   */
  test("a thrown lookup is quoted and beats the socket and time-limit wording", () => {
    const note: string = noteFor(
      undefined,
      makeNetbiosOutcome({
        isTimeBudgetExhausted: true,
        failureReason: "bind timed out",
        error: "boom",
      }),
    );

    expect(note).toBe("NetBIOS lookups failed on this probe (boom).");

    const long: string = noteFor(
      undefined,
      makeNetbiosOutcome({ error: LONG_SOCKET_REASON }),
    );
    const quoted: RegExpMatchArray | null = long.match(
      /^NetBIOS lookups failed on this probe \((.+)\)\.$/,
    );

    expect(quoted).not.toBeNull();
    expect(quoted![1]!.length).toBe(MAX_NAMING_REASON_EXCERPT_LENGTH);
    expect(quoted![1]!.endsWith("…")).toBe(true);

    expect(
      noteFor(undefined, makeNetbiosOutcome({ error: "socket closed." })),
    ).toBe("NetBIOS lookups failed on this probe (socket closed).");
  });

  /*
   * The cap is a separate fact from how the lookup ended, so it is stated
   * first and the failure follows it rather than replacing it.
   */
  test("the cap sentence still comes first when the lookup also threw", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          isHostCapReached: true,
          error: "boom",
        }),
      ),
    ).toBe(`${NETBIOS_CAP_NOTE} NetBIOS lookups failed on this probe (boom).`);
  });
});

describe("buildHostNamingNote — NetBIOS ran out of time", () => {
  /*
   * The denominator is the hosts the lookup MEANT to ask — eligible, cut to
   * the cap — not the eligible count. "named 40 of 3,500" beside a cap
   * sentence that already accounted for 1,500 of them would count those hosts
   * twice.
   */
  test("with the cap also reached, both sentences appear in order and the target is the cap", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          queriedAddressCount: 1200,
          isHostCapReached: true,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toBe(
      `${NETBIOS_CAP_NOTE} ` +
        "NetBIOS named 40 of 2,000 hosts before its 2m time limit; 800 were never queried.",
    );
  });

  test("under the cap, the target is the eligible count", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 300,
          eligibleAddressCount: 150,
          queriedAddressCount: 100,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 30000,
        }),
      ),
    ).toBe(
      "NetBIOS named 40 of 150 hosts before its 30s time limit; 50 were never queried.",
    );
  });

  // Subject and verb agree here too.
  test("one unqueried host reads '1 was never queried'", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 300,
          eligibleAddressCount: 150,
          queriedAddressCount: 149,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 30000,
        }),
      ),
    ).toBe(
      "NetBIOS named 40 of 150 hosts before its 30s time limit; 1 was never queried.",
    );
  });

  test("with no cap reported, the target is the eligible count on its own", () => {
    expect(
      noteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 300,
          eligibleAddressCount: 150,
          queriedAddressCount: 100,
          maxHosts: undefined,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 30000,
        }),
      ),
    ).toBe(
      "NetBIOS named 40 of 150 hosts before its 30s time limit; 50 were never queried.",
    );
  });

  /*
   * A resolution that reported neither the eligible count nor the queried
   * count nor its budget: the sentence falls back to the unnamed hosts it was
   * handed and states only what it knows.
   */
  test("with nothing reported, falls back to the unnamed count and leaves out what it does not know", () => {
    const note: string = noteFor(
      undefined,
      makeNetbiosOutcome({
        unnamedAddressCount: 300,
        eligibleAddressCount: undefined,
        queriedAddressCount: undefined,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: undefined,
      }),
    );

    expect(note).toBe("NetBIOS named 40 of 300 hosts before its time limit.");
    expect(note).not.toContain("undefined");
  });

  /*
   * Every host was asked and the budget ran out waiting on the replies. "0
   * were never queried" would be noise, and a queried count ABOVE the target
   * (a double's arithmetic) must not render as a negative one.
   */
  test("the never-queried clause appears only when some hosts really were not queried", () => {
    const base: Partial<NetbiosNamingOutcome> = {
      unnamedAddressCount: 3500,
      eligibleAddressCount: 3500,
      isTimeBudgetExhausted: true,
    };

    for (const queried of [2000, 2500, undefined, NaN]) {
      const note: string = noteFor(
        undefined,
        makeNetbiosOutcome({ ...base, queriedAddressCount: queried }),
      );

      expect(note).toBe(
        "NetBIOS named 40 of 2,000 hosts before its 2m time limit.",
      );
      expect(note).not.toContain("never queried");
    }
  });
});

describe("buildHostNamingNote — both passes cut short", () => {
  /*
   * Reverse DNS runs first and names more, so its sentence leads; NetBIOS is
   * the fallback for what is left. One space between them, and no stray space
   * when only one of the two has anything to say — in either form.
   */
  test("reverse DNS first, then NetBIOS, joined by a single space", () => {
    const reverseDns: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      notLookedUpAddressCount: 2700,
      isTimeBudgetExhausted: true,
    });
    const netbios: NetbiosNamingOutcome = makeNetbiosOutcome({
      unnamedAddressCount: 3500,
      eligibleAddressCount: 3500,
      queriedAddressCount: 2000,
      isHostCapReached: true,
    });

    const netbiosNote: string = NETBIOS_CAP_NOTE;
    const netbiosCompactNote: string = NETBIOS_CAP_COMPACT_NOTE;

    expect(noteFor(reverseDns, netbios)).toBe(
      `${EXHAUSTED_REVERSE_DNS_NOTE} ${netbiosNote}`,
    );
    expect(noteFor(undefined, netbios)).toBe(netbiosNote);
    expect(noteFor(reverseDns, makeNetbiosOutcome())).toBe(
      EXHAUSTED_REVERSE_DNS_NOTE,
    );
    expect(noteFor(reverseDns, netbios)).not.toContain("  ");

    expect(compactNoteFor(reverseDns, netbios)).toBe(
      `${EXHAUSTED_REVERSE_DNS_COMPACT_NOTE} ${netbiosCompactNote}`,
    );
    expect(compactNoteFor(undefined, netbios)).toBe(netbiosCompactNote);
    expect(compactNoteFor(reverseDns, makeNetbiosOutcome())).toBe(
      EXHAUSTED_REVERSE_DNS_COMPACT_NOTE,
    );
  });

  // The form argument is optional, and leaving it out means the full sentences.
  test("the default form is the full one", () => {
    for (const reverseDns of reverseDnsOutcomeGrid()) {
      const result: SubnetScanResult = makeResult({
        reverseDnsOutcome: reverseDns.outcome,
        netbiosOutcome: makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          isHostCapReached: true,
        }),
      });

      expect(buildHostNamingNote(result)).toBe(
        buildHostNamingNote(result, "full"),
      );
    }
  });
});

/*
 * The COMPACT note: what the message carries when the full sentences would
 * push it past the column. Same facts, fewer words — which outcome, the
 * counts that size it, and a 40-character excerpt of the reason — and never
 * the advice, which is the part an operator can look up once they know what
 * happened.
 */
describe("buildHostNamingNote — the compact reverse-DNS sentence", () => {
  test("a thrown pass reads 'Reverse DNS failed (<reason>).', named or not", () => {
    expect(
      compactNoteFor(
        makeReverseDnsOutcome({
          namedAddressCount: 12,
          error: "resolver pool exhausted",
        }),
      ),
    ).toBe("Reverse DNS failed (resolver pool exhausted).");
    expect(
      compactNoteFor(
        makeReverseDnsOutcome({
          namedAddressCount: 0,
          error: " resolver pool exhausted. ",
        }),
      ),
    ).toBe("Reverse DNS failed (resolver pool exhausted).");
  });

  test("a resolver with no answers reads 'Reverse DNS got no answers', with its reason when it has one", () => {
    const unavailable: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      resolvedCount: 0,
      namedAddressCount: 0,
      notLookedUpAddressCount: 3968,
      isReverseDnsAvailable: false,
      isTimeBudgetExhausted: true,
    });

    expect(compactNoteFor(unavailable)).toBe("Reverse DNS got no answers.");
    expect(
      compactNoteFor({
        ...unavailable,
        failureReason: "queryPtr ESERVFAIL 10.in-addr.arpa.",
      }),
    ).toBe("Reverse DNS got no answers (queryPtr ESERVFAIL 10.in-addr.arpa).");
    /*
     * A reason that is nothing but a period keeps it rather than quoting
     * nothing: see the quoteReason describe above for why an empty pair of
     * parentheses is worse than a useless one.
     */
    expect(compactNoteFor({ ...unavailable, failureReason: " . " })).toBe(
      "Reverse DNS got no answers (.).",
    );
  });

  test("out of time with hosts unasked reads how many of how many were not looked up", () => {
    expect(
      compactNoteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toBe(EXHAUSTED_REVERSE_DNS_COMPACT_NOTE);
    expect(
      compactNoteFor(
        makeReverseDnsOutcome({
          addressCount: 15360,
          namedAddressCount: 12345,
          notLookedUpAddressCount: 3015,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 250000,
        }),
      ),
    ).toBe(
      "Reverse DNS hit its 4m 10s limit; 3,015 of 15,360 hosts not looked up.",
    );
  });

  /*
   * Nothing left unasked, or no count to say so: the compact sentence reports
   * what WAS named instead of an unasked count of zero or of nothing.
   */
  test("out of time with none unasked, or an unknown count, reads how many were named", () => {
    for (const notLookedUp of [0, undefined, NaN]) {
      expect(
        compactNoteFor(
          makeReverseDnsOutcome({
            notLookedUpAddressCount: notLookedUp,
            isTimeBudgetExhausted: true,
          }),
        ),
      ).toBe(
        "Reverse DNS hit its 10m limit after naming 1,200 of 4,000 hosts.",
      );
    }
  });

  /*
   * With no figure to name, both forms fall back to the same two words: there
   * is no "<b> limit" to shorten when there is no <b>.
   */
  test("an unknown budget reads 'hit its time limit' with no figure", () => {
    expect(
      compactNoteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: undefined,
        }),
      ),
    ).toBe(
      "Reverse DNS hit its time limit; 2,700 of 4,000 hosts not looked up.",
    );
    expect(
      compactNoteFor(
        makeReverseDnsOutcome({
          notLookedUpAddressCount: 0,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 0.4,
        }),
      ),
    ).toBe("Reverse DNS hit its time limit after naming 1,200 of 4,000 hosts.");
  });

  test("a one-host sweep reads '1 host', not '1 hosts'", () => {
    const oneHost: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      resolvedCount: 0,
      addressCount: 1,
      namedAddressCount: 0,
      notLookedUpAddressCount: 1,
      isTimeBudgetExhausted: true,
      totalBudgetInMs: 60000,
    });

    expect(compactNoteFor(oneHost)).toBe(
      "Reverse DNS hit its 1m limit; 1 of 1 host not looked up.",
    );
    expect(compactNoteFor({ ...oneHost, notLookedUpAddressCount: 0 })).toBe(
      "Reverse DNS hit its 1m limit after naming 0 of 1 host.",
    );
  });

  // The same order of precedence as the full sentences.
  test("a throw beats no answers, and no answers beats the time limit", () => {
    const everything: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      namedAddressCount: 0,
      notLookedUpAddressCount: 4000,
      isReverseDnsAvailable: false,
      isTimeBudgetExhausted: true,
      failureReason: BROKEN_RESOLVER_REASON,
      error: "boom",
    });

    expect(compactNoteFor(everything)).toBe("Reverse DNS failed (boom).");
    expect(compactNoteFor({ ...everything, error: undefined })).toBe(
      `Reverse DNS got no answers (${BROKEN_RESOLVER_REASON}).`,
    );
  });

  test("a long reason is excerpted to exactly 40 characters, ellipsis included, and one at 40 is quoted whole", () => {
    expect(LONG_RESOLVER_ERROR.length).toBeGreaterThan(
      MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH,
    );

    const thrown: RegExpMatchArray | null = compactNoteFor(
      makeReverseDnsOutcome({ error: LONG_RESOLVER_ERROR }),
    ).match(/^Reverse DNS failed \((.+)\)\.$/);
    const unanswered: RegExpMatchArray | null = compactNoteFor(
      makeReverseDnsOutcome({
        namedAddressCount: 0,
        isReverseDnsAvailable: false,
        failureReason: LONG_RESOLVER_ERROR,
      }),
    ).match(/^Reverse DNS got no answers \((.+)\)\.$/);

    for (const quoted of [thrown, unanswered]) {
      expect(quoted).not.toBeNull();
      expect(quoted![1]!.length).toBe(MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH);
      expect(quoted![1]!.endsWith("…")).toBe(true);
      expect(LONG_RESOLVER_ERROR.startsWith(quoted![1]!.slice(0, -1))).toBe(
        true,
      );
    }

    const atCap: string = LONG_RESOLVER_ERROR.substring(
      0,
      MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH,
    );

    expect(compactNoteFor(makeReverseDnsOutcome({ error: atCap }))).toBe(
      `Reverse DNS failed (${atCap}).`,
    );
  });
});

describe("buildHostNamingNote — the compact NetBIOS sentences", () => {
  test("the cap reads how many hosts were skipped over the cap, with counts formatted and '1 host' singular", () => {
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          queriedAddressCount: 2000,
          isHostCapReached: true,
        }),
      ),
    ).toBe("NetBIOS skipped 1,500 hosts over its 2,000-host cap.");
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 2001,
          eligibleAddressCount: 2001,
          queriedAddressCount: 2000,
          isHostCapReached: true,
        }),
      ),
    ).toBe("NetBIOS skipped 1 host over its 2,000-host cap.");
  });

  test("a cap without its counts reads 'NetBIOS hit its host cap.'", () => {
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: undefined,
          isHostCapReached: true,
        }),
      ),
    ).toBe("NetBIOS hit its host cap.");
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          maxHosts: undefined,
          isHostCapReached: true,
        }),
      ),
    ).toBe("NetBIOS hit its host cap.");
  });

  test("a thrown lookup reads 'NetBIOS failed (<reason>).', after the cap when both apply", () => {
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          isTimeBudgetExhausted: true,
          failureReason: BIND_TIMEOUT_REASON,
          error: "boom.",
        }),
      ),
    ).toBe("NetBIOS failed (boom).");
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          isHostCapReached: true,
          error: "boom",
        }),
      ),
    ).toBe(
      "NetBIOS skipped 1,500 hosts over its 2,000-host cap. NetBIOS failed (boom).",
    );
  });

  /*
   * One compact sentence for the socket whether it never bound or failed
   * partway: "did not run" versus "stopped" is a distinction the full form
   * has room for, and the reason quoted beside it already carries it.
   */
  test("a socket failure reads 'NetBIOS socket failed (<reason>).' whatever was queried, and beats the time limit", () => {
    for (const queried of [0, undefined, 1500]) {
      expect(
        compactNoteFor(
          undefined,
          makeNetbiosOutcome({
            resolvedCount: queried === 1500 ? 3 : 0,
            namedAddressCount: queried === 1500 ? 3 : 0,
            queriedAddressCount: queried,
            isTimeBudgetExhausted: true,
            failureReason: BIND_TIMEOUT_REASON,
          }),
        ),
      ).toBe("NetBIOS socket failed (The UDP socket did not bind in time).");
    }
  });

  test("out of time with hosts unqueried reads how many of how many were not queried", () => {
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          queriedAddressCount: 1200,
          isHostCapReached: true,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toBe(
      `${NETBIOS_CAP_COMPACT_NOTE} ` +
        "NetBIOS hit its 2m limit; 800 of 2,000 hosts not queried.",
    );
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 300,
          eligibleAddressCount: 150,
          queriedAddressCount: 149,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: 30000,
        }),
      ),
    ).toBe("NetBIOS hit its 30s limit; 1 of 150 hosts not queried.");
  });

  test("out of time with none unqueried, or an unknown count or budget, reads how many were named", () => {
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          queriedAddressCount: 2000,
          isTimeBudgetExhausted: true,
        }),
      ),
    ).toBe("NetBIOS hit its 2m limit after naming 40 of 2,000 hosts.");
    expect(
      compactNoteFor(
        undefined,
        makeNetbiosOutcome({
          unnamedAddressCount: 300,
          eligibleAddressCount: undefined,
          queriedAddressCount: undefined,
          isTimeBudgetExhausted: true,
          totalBudgetInMs: undefined,
        }),
      ),
      /*
       * The FULL sentence, because with no budget figure the compact frame
       * would be the longer of the two and shorterNoteForm hands back the
       * full one instead. See "the compact form against the full form".
       */
    ).toBe("NetBIOS named 40 of 300 hosts before its time limit.");
  });

  test("long reasons are excerpted to exactly 40 characters on both failure sentences", () => {
    const thrown: RegExpMatchArray | null = compactNoteFor(
      undefined,
      makeNetbiosOutcome({ error: LONG_SOCKET_REASON }),
    ).match(/^NetBIOS failed \((.+)\)\.$/);
    const socket: RegExpMatchArray | null = compactNoteFor(
      undefined,
      makeNetbiosOutcome({ failureReason: LONG_SOCKET_REASON }),
    ).match(/^NetBIOS socket failed \((.+)\)\.$/);

    for (const quoted of [thrown, socket]) {
      expect(quoted).not.toBeNull();
      expect(quoted![1]!.length).toBe(MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH);
      expect(quoted![1]!.endsWith("…")).toBe(true);
      expect(LONG_SOCKET_REASON.startsWith(quoted![1]!.slice(0, -1))).toBe(
        true,
      );
    }
  });
});

describe("buildHostNamingNote — the compact form against the full form", () => {
  /*
   * The compact form exists to be the SHORTER of the two: the status message
   * reaches for it only when the full sentences do not fit, and a compact
   * sentence that is LONGER makes the message give up the sweep's own
   * sentences for nothing.
   *
   * Nothing is excluded from the comparison, and nothing needs to be. Two
   * shapes used to be longer in compact form; naming a budget "<b> limit"
   * instead of "<b> time limit" fixed one, and shorterNoteForm in FetchScans.ts
   * fixed the rest by falling back to the full sentence whenever the compact
   * one would cost more characters than it saves. That fallback is the
   * property this whole describe block pins: it must hold for every shape, not
   * for the ones somebody remembered.
   */

  /*
   * The shape that needed the fallback: NetBIOS out of time, with no budget
   * figure to print and no unqueried count to report.
   *
   *   full:    "NetBIOS named 0 of 1,500 hosts before its time limit."
   *   compact: "NetBIOS hit its time limit after naming 0 of 1,500 hosts."
   *
   * "<b> limit" is shorter than "<b> time limit", but with no <b> to name,
   * both forms fall back to the same two words and the compact frame ("hit
   * its ... after naming ...") is four characters longer than the full one
   * ("named ... before its ..."). Asking for the compact form must therefore
   * hand back the FULL sentence here.
   */
  const NO_FIGURE_NETBIOS_OUTCOME: NetbiosNamingOutcome = {
    resolvedCount: 0,
    unnamedAddressCount: 1500,
    namedAddressCount: 0,
    isHostCapReached: false,
    isTimeBudgetExhausted: true,
    totalBudgetInMs: undefined,
  };

  test("falls back to the full sentence for the one shape whose compact wording is longer", () => {
    const full: string = noteFor(undefined, NO_FIGURE_NETBIOS_OUTCOME);
    const compact: string = compactNoteFor(
      undefined,
      NO_FIGURE_NETBIOS_OUTCOME,
    );

    expect(full).toBe("NetBIOS named 0 of 1,500 hosts before its time limit.");
    expect(compact).toBe(full);
  });

  test("every reverse-DNS shape's compact sentence is no longer than its full one", () => {
    const longer: Array<string> = [];

    for (const entry of reverseDnsOutcomeGrid()) {
      const full: string = noteFor(entry.outcome);
      const compact: string = compactNoteFor(entry.outcome);

      // The two are silent together, or neither is.
      expect(`${entry.name}: ${compact.length > 0}`).toBe(
        `${entry.name}: ${full.length > 0}`,
      );

      if (compact.length > full.length) {
        longer.push(`${entry.name}: ${compact.length} > ${full.length}`);
      }
    }

    expect(longer).toEqual([]);
  });

  test("every NetBIOS shape's compact sentence is no longer than its full one", () => {
    const longer: Array<string> = [];

    for (const entry of netbiosOutcomeGrid()) {
      const full: string = noteFor(undefined, entry.outcome);
      const compact: string = compactNoteFor(undefined, entry.outcome);

      expect(`${entry.name}: ${compact.length > 0}`).toBe(
        `${entry.name}: ${full.length > 0}`,
      );

      if (compact.length > full.length) {
        longer.push(`${entry.name}: ${compact.length} > ${full.length}`);
      }
    }

    expect(longer).toEqual([]);
  });

  /*
   * And the note as a whole. The two halves are joined by one space and each
   * is independently no longer in compact form, so the pair cannot be either —
   * checked on a seeded sample of pairs rather than on the full cross, which
   * asserted the same joins thousands of times over.
   */
  test("over a seeded sample of pairs, compact is no longer than full, and the two are silent together", () => {
    const random: () => number = makeSeededRandom(3677);
    const reverseDnsGrid: Array<GridEntry<ReverseDnsNamingOutcome>> =
      reverseDnsOutcomeGrid();
    const netbiosGrid: Array<GridEntry<NetbiosNamingOutcome>> =
      netbiosOutcomeGrid();
    let reportingPairs: number = 0;

    for (let iteration: number = 0; iteration < 200; iteration++) {
      const reverseDns: GridEntry<ReverseDnsNamingOutcome> = pickOne(
        random,
        reverseDnsGrid,
      );
      const netbios: GridEntry<NetbiosNamingOutcome> = pickOne(
        random,
        netbiosGrid,
      );
      const result: SubnetScanResult = makeResult({
        reverseDnsOutcome: reverseDns.outcome,
        netbiosOutcome: netbios.outcome,
      });
      const full: string = buildHostNamingNote(result, "full");
      const compact: string = buildHostNamingNote(result, "compact");
      const name: string = `${reverseDns.name} + ${netbios.name}`;

      if (full) {
        reportingPairs++;
      }

      expect(`${name}: ${compact.length > 0}`).toBe(
        `${name}: ${full.length > 0}`,
      );
      expect(`${name}: ${compact}`).not.toContain(REVERSE_DNS_BUDGET_ENV_VAR);
      expect(`${name}: ${compact}`).not.toContain(NETBIOS_MAX_HOSTS_ENV_VAR);
      expect(compact).not.toContain("  ");
      expect(compact).not.toContain("undefined");
      expect(compact).not.toContain("NaN");

      if (compact.length > full.length) {
        // Named, so a failure says which pair rather than only "false".
        expect(`${name}: ${compact}`).toBe(
          `${name}: at most ${full.length} characters`,
        );
      }
    }

    // Guard on the guard: the sample is mostly pairs that have something to say.
    expect(reportingPairs).toBeGreaterThan(150);
  });

  /*
   * The word the compact form drops. "before its 4m 10s time limit" has room
   * to say what kind of limit it is; "hit its 4m 10s limit" is already about a
   * clock, and the five characters are the difference between the compact
   * sentence being shorter than the full one and being longer than it.
   */
  test("a named budget reads '<b> time limit' in full and '<b> limit' compact, on both passes", () => {
    const budgets: Array<[number, string]> = [
      [750, "750ms"],
      [30000, "30s"],
      [250000, "4m 10s"],
      [600000, "10m"],
    ];

    for (const [budgetInMs, figure] of budgets) {
      const reverseDns: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
        notLookedUpAddressCount: 2700,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: budgetInMs,
      });
      const netbios: NetbiosNamingOutcome = makeNetbiosOutcome({
        queriedAddressCount: 1200,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: budgetInMs,
      });

      expect(noteFor(reverseDns)).toContain(`before its ${figure} time limit`);
      expect(compactNoteFor(reverseDns)).toContain(`hit its ${figure} limit;`);
      expect(compactNoteFor(reverseDns)).not.toContain(`${figure} time limit`);

      expect(noteFor(undefined, netbios)).toContain(
        `before its ${figure} time limit`,
      );
      expect(compactNoteFor(undefined, netbios)).toContain(
        `hit its ${figure} limit;`,
      );
      expect(compactNoteFor(undefined, netbios)).not.toContain(
        `${figure} time limit`,
      );
    }
  });

  /*
   * With no figure to name, there is nothing to shorten: both forms say "time
   * limit", because "hit its limit" alone would not say what ran out.
   */
  test("an unknown budget reads 'time limit' in both forms", () => {
    for (const budget of [undefined, NaN, 0, 0.4]) {
      const reverseDns: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
        notLookedUpAddressCount: 2700,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: budget,
      });

      expect(noteFor(reverseDns)).toContain("before its time limit;");
      expect(compactNoteFor(reverseDns)).toContain("hit its time limit;");
    }
  });

  test("where the compact form is strictly shorter, it is shorter for every failure sentence that quotes a reason", () => {
    const failures: Array<SubnetScanResult> = [
      makeResult({
        reverseDnsOutcome: makeReverseDnsOutcome({
          namedAddressCount: 0,
          error: LONG_RESOLVER_ERROR,
        }),
      }),
      makeResult({
        reverseDnsOutcome: makeReverseDnsOutcome({
          namedAddressCount: 0,
          isReverseDnsAvailable: false,
          failureReason: LONG_RESOLVER_ERROR,
        }),
      }),
      makeResult({
        netbiosOutcome: makeNetbiosOutcome({ error: LONG_SOCKET_REASON }),
      }),
      makeResult({
        netbiosOutcome: makeNetbiosOutcome({
          queriedAddressCount: 0,
          failureReason: LONG_SOCKET_REASON,
        }),
      }),
    ];

    for (const result of failures) {
      expect(buildHostNamingNote(result, "compact").length).toBeLessThan(
        buildHostNamingNote(result, "full").length,
      );
    }
  });
});

describe("buildScanStatusMessage — carries the host-naming note", () => {
  test("the SNMP message ends with the note, after the sweep's own sentences", () => {
    expect(
      buildScanStatusMessage(
        makeResult({
          respondedToPingCount: 12,
          reverseDnsOutcome: makeReverseDnsOutcome({
            notLookedUpAddressCount: 2700,
            isTimeBudgetExhausted: true,
          }),
        }),
        3,
      ),
    ).toBe(
      `Swept 254 hosts: 12 answered ICMP ping, 3 answered SNMP. ${EXHAUSTED_REVERSE_DNS_NOTE}`,
    );
  });

  /*
   * The ICMP-only return is a separate return, and the one that needs the
   * note most: a ping-only host has no sysName to fall back on, so a naming
   * pass that stopped leaves it with nothing but its address.
   */
  test("the ICMP-only message ends with the note too", () => {
    const note: string =
      "Reverse DNS lookups from this probe got no answers, so none of the 12 hosts got a reverse DNS name - " +
      "check the probe's DNS resolver and the reverse DNS zone for this range.";

    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({
          reverseDnsOutcome: makeReverseDnsOutcome({
            resolvedCount: 0,
            addressCount: 12,
            namedAddressCount: 0,
            isReverseDnsAvailable: false,
          }),
        }),
        0,
      ),
    ).toBe(
      `Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping. ${note}`,
    );
  });

  test("an incomplete ping sweep keeps its caveat first, then the tally, then the note", () => {
    const result: SubnetScanResult = makeIcmpOnlyResult({
      respondedToPingCount: 3,
      isIcmpSweepIncomplete: true,
      netbiosOutcome: makeNetbiosOutcome({
        resolvedCount: 0,
        unnamedAddressCount: 3,
        namedAddressCount: 0,
        eligibleAddressCount: 3,
        queriedAddressCount: 0,
        failureReason: "bind timed out",
        isTimeBudgetExhausted: true,
      }),
    });

    const message: string = buildScanStatusMessage(result, 0);
    const note: string =
      "NetBIOS lookups did not run because the probe's UDP socket failed (bind timed out).";

    expect(message).toBe(
      `${buildScanStatusMessage(withoutNamingOutcomes(result), 0)} ${note}`,
    );
    expect(message.indexOf("This ping sweep stopped early")).toBe(0);
    expect(message.indexOf("This ping sweep stopped early")).toBeLessThan(
      message.indexOf("Swept 254 hosts with ICMP ping only"),
    );
    expect(message.endsWith(note)).toBe(true);
  });

  /*
   * The premise for every composition test below that spells the ICMP-only
   * sentences out: the constants are the sentences the builder really prints.
   * The 572-character combination is clipped to the column by the no-note
   * path, so its head is checked character for character.
   */
  test("the ICMP-only sentence constants match the builder", () => {
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({
          scannedHostCount: 1024,
          respondedToPingCount: 3,
          isIcmpSweepIncomplete: true,
        }),
        0,
      ),
    ).toBe(`${ICMP_STOPPED_EARLY_CAVEAT} ${icmpOnlyHeadline(1024, 3)}`);

    const unclipped: string = `${ICMP_STOPPED_EARLY_CAVEAT} ${icmpOnlyHeadline(32768, 0)} ${ICMP_NOTHING_ANSWERED_ADVICE}`;

    expect(unclipped.length).toBe(572);
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({
          scannedHostCount: 32768,
          respondedToPingCount: 0,
          isIcmpSweepIncomplete: true,
        }),
        0,
      ),
    ).toBe(`${unclipped.substring(0, STATUS_MESSAGE_COLUMN_LENGTH - 1)}…`);
    expect(
      buildScanStatusMessage(
        makeResult({ respondedToPingCount: undefined }),
        3,
      ),
    ).toContain(snmpHeadline(254, undefined, 3));
  });

  /*
   * The 572-character ICMP-only combination this file already pins, now with
   * a note on the end. Neither form fits beside the whole body, so the note
   * goes compact and the clip moves INTO the sweep's advice — while the caveat
   * and the tally ahead of it, the ESSENTIAL sentences, survive whole.
   */
  test("the over-long ICMP-only message clips the advice, not the compact note, the caveat or the tally", () => {
    const result: SubnetScanResult = makeIcmpOnlyResult({
      scannedHostCount: 32768,
      respondedToPingCount: 0,
      isIcmpSweepIncomplete: true,
      reverseDnsOutcome: makeReverseDnsOutcome({
        resolvedCount: 0,
        addressCount: 1,
        namedAddressCount: 0,
        isReverseDnsAvailable: false,
      }),
    });
    const compactNote: string = "Reverse DNS got no answers.";
    const essential: string = `${ICMP_STOPPED_EARLY_CAVEAT} ${icmpOnlyHeadline(32768, 0)}`;

    expect(buildHostNamingNote(result, "compact")).toBe(compactNote);

    const message: string = buildScanStatusMessage(result, 0);
    const middle: string = clippedMiddleOf(message, essential, compactNote);

    expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(middle.endsWith("…")).toBe(true);
    expect(ICMP_NOTHING_ANSWERED_ADVICE.startsWith(middle.slice(0, -1))).toBe(
      true,
    );
    expect(countEllipses(message)).toBe(1);
    // The full sentence is not what was printed.
    expect(message).not.toContain("got a reverse DNS name");
  });
});

describe("buildScanStatusMessage — no note leaves the message exactly as it was", () => {
  /*
   * The note must be invisible on every healthy scan. Byte-for-byte, not
   * "contains the same sentences": a stray trailing space, or a switch from
   * clipStatusMessage to the note-aware composition when there is no note,
   * would change messages operators have already learned to read — including
   * where an over-long one is cut.
   */
  test("complete and empty naming passes produce the identical message across every fixture shape", () => {
    const silentOutcomes: Array<Partial<SubnetScanResult>> = [
      {
        reverseDnsOutcome: makeReverseDnsOutcome(),
        netbiosOutcome: makeNetbiosOutcome(),
      },
      {
        reverseDnsOutcome: makeReverseDnsOutcome({
          resolvedCount: 0,
          namedAddressCount: 0,
        }),
      },
      {
        // A healthy pass that still carries a stray per-lookup reason.
        reverseDnsOutcome: makeReverseDnsOutcome({
          failureReason: "queryPtr ETIMEOUT 10.0.0.5",
        }),
      },
      {
        /*
         * A pass that counted its failures and had none (OneUptime issue
         * #3916): every address answered, named or "no record". The count
         * being present must not change a byte.
         */
        reverseDnsOutcome: makeReverseDnsOutcome({ failedAddressCount: 0 }),
      },
      {
        // A nonsense failure count reads as none, never as a sentence.
        reverseDnsOutcome: makeReverseDnsOutcome({ failedAddressCount: NaN }),
        // And a skip flag that is not exactly true is no skip.
        isNetbiosLookupSkippedOnGlobalProbe: false,
      },
      {
        // Nothing to name: the flags are set but there were no addresses.
        reverseDnsOutcome: makeReverseDnsOutcome({
          resolvedCount: 0,
          addressCount: 0,
          namedAddressCount: 0,
          isTimeBudgetExhausted: true,
          isReverseDnsAvailable: false,
        }),
        netbiosOutcome: makeNetbiosOutcome({
          resolvedCount: 0,
          unnamedAddressCount: 0,
          namedAddressCount: 0,
          isHostCapReached: true,
          isTimeBudgetExhausted: true,
        }),
      },
    ];

    const tenLongConfigs: Array<SubnetScanSnmpConfig> = [];

    for (let index: number = 0; index < 10; index++) {
      tenLongConfigs.push(
        makeSnmpConfig({
          id: `config-${index}`,
          label: `${"N".repeat(100)} (V2c)`,
        }),
      );
    }

    const shapes: Array<{
      result: SubnetScanResult;
      snmpResponderCount: number;
      snmpConfigs: Array<SubnetScanSnmpConfig>;
    }> = [
      { result: makeResult(), snmpResponderCount: 0, snmpConfigs: [] },
      {
        result: makeResult({ respondedToPingCount: 12 }),
        snmpResponderCount: 3,
        snmpConfigs: [],
      },
      {
        result: makeResult({ respondedToPingCount: undefined }),
        snmpResponderCount: 3,
        snmpConfigs: [],
      },
      {
        result: makeResult({
          snmpErrorHostCount: 11,
          mostCommonSnmpError: "Authentication failure",
        }),
        snmpResponderCount: 0,
        snmpConfigs: [],
      },
      {
        // The ten fully-named credentials — a message that is already clipped.
        result: makeResult({
          scannedHostCount: 4096,
          respondedToPingCount: 4096,
          icmpFilteredFallbackHostCount: 4096,
          snmpErrorHostCount: 4096,
          scannedPorts: [161, 1161],
          mostCommonSnmpError: "E".repeat(120),
          responderCountByConfigId: { "config-0": 12 },
        }),
        snmpResponderCount: 12,
        snmpConfigs: tenLongConfigs,
      },
      { result: makeIcmpOnlyResult(), snmpResponderCount: 0, snmpConfigs: [] },
      {
        result: makeIcmpOnlyResult({
          respondedToPingCount: 3,
          isIcmpSweepIncomplete: true,
        }),
        snmpResponderCount: 0,
        snmpConfigs: [],
      },
      {
        // The 572-character ICMP-only message, clipped to the column.
        result: makeIcmpOnlyResult({
          scannedHostCount: 32768,
          respondedToPingCount: 0,
          isIcmpSweepIncomplete: true,
        }),
        snmpResponderCount: 0,
        snmpConfigs: [],
      },
    ];

    for (const shape of shapes) {
      const expected: string = buildScanStatusMessage(
        withoutNamingOutcomes(shape.result),
        shape.snmpResponderCount,
        shape.snmpConfigs,
      );

      for (const outcomes of silentOutcomes) {
        const result: SubnetScanResult = { ...shape.result, ...outcomes };

        // The premise: these outcomes really do produce no note, in either form.
        expect(buildHostNamingNote(result)).toBe("");
        expect(buildHostNamingNote(result, "compact")).toBe("");
        expect(
          buildScanStatusMessage(
            result,
            shape.snmpResponderCount,
            shape.snmpConfigs,
          ),
        ).toBe(expected);
      }
    }
  });
});

/*
 * The composition ladder (finishStatusMessage in FetchScans.ts). When there is
 * a note, the message gives up as little as it can, in this order:
 *
 *   1. the whole body and the FULL note, when that fits the column;
 *   2. the whole body and the COMPACT note, when that fits;
 *   3. the ESSENTIAL sentences whole (the headline; on an incomplete ICMP-only
 *      sweep, the caveat and the headline), the rest of the body clipped with
 *      one ellipsis, and the compact note whole at the end.
 *
 * Each rung, each boundary between rungs, and the invariants that hold across
 * all of them are asserted below.
 */
describe("buildScanStatusMessage — the composition ladder", () => {
  /*
   * The steering phrase carries NO periods (the agent's address is written
   * with dashes) so that a cut of it at any length ends without terminal
   * punctuation. That is what the sweep's SNMP-error sentence really looks
   * like — it ends with the quoted error itself — and it keeps the full stop
   * the ladder inserts before the note (joinBeforeNote) at a length this
   * describe can count rather than one that depends on where the cut landed.
   */
  const BOUNDARY_ERROR_PHRASE: string =
    "Report PDU usmStatsNotInTimeWindows from agent 10-20-30-40:161, engine boots 7, engine time 86400; ";

  const BOUNDARY_HEADLINE: string = snmpHeadline(254, 12, 3);

  /*
   * A result whose body length is steered to the character through the quoted
   * SNMP error, which buildScanStatusMessage prints unbounded, carrying the
   * canonical out-of-time reverse-DNS outcome.
   */
  function makeBoundaryResult(errorLength: number): SubnetScanResult {
    return makeResult({
      respondedToPingCount: 12,
      snmpErrorHostCount: 2,
      mostCommonSnmpError: textOfLength(BOUNDARY_ERROR_PHRASE, errorLength),
      reverseDnsOutcome: makeReverseDnsOutcome({
        notLookedUpAddressCount: 2700,
        isTimeBudgetExhausted: true,
      }),
    });
  }

  /*
   * A whole body and a note, as the ladder joins them: one space, and a full
   * stop first when the body's last sentence has none. Every body in this
   * describe ends with the quoted SNMP error and so needs the stop — asserted
   * per case rather than assumed.
   */
  function bodyThenNote(body: string, note: string): string {
    expect(".!?…".includes(body.charAt(body.length - 1))).toBe(false);

    return `${body}. ${note}`;
  }

  /*
   * The error length at which the joined message is exactly the column: the
   * body, the inserted full stop, the space and the note.
   */
  function exactFitErrorLength(note: string): number {
    const bodyWithOneCharacterError: number = buildScanStatusMessage(
      withoutNamingOutcomes(makeBoundaryResult(1)),
      3,
    ).length;

    return (
      STATUS_MESSAGE_COLUMN_LENGTH -
      2 -
      note.length -
      (bodyWithOneCharacterError - 1)
    );
  }

  /*
   * RUNG 1 and its boundary. A body that fits beside the full note to the
   * character keeps it — an operator should get the advice whenever there is
   * room for it — and one character more must not clip anything: it falls to
   * the compact note beside the SAME, whole body.
   */
  test("the full note is used up to exactly the column, and one character more falls to the compact note", () => {
    const errorLength: number = exactFitErrorLength(EXHAUSTED_REVERSE_DNS_NOTE);

    expect(errorLength).toBeGreaterThan(1);

    for (const overBy of [-1, 0, 1, 2]) {
      const result: SubnetScanResult = makeBoundaryResult(errorLength + overBy);
      const body: string = buildScanStatusMessage(
        withoutNamingOutcomes(result),
        3,
      );

      /*
       * The premises, per case: the lengths really are where they are claimed
       * to be. Two characters, not one, between the body and the note - the
       * space and the full stop the body's last sentence does not end with.
       */
      expect(body.length + 2 + EXHAUSTED_REVERSE_DNS_NOTE.length).toBe(
        STATUS_MESSAGE_COLUMN_LENGTH + overBy,
      );
      expect(buildHostNamingNote(result)).toBe(EXHAUSTED_REVERSE_DNS_NOTE);
      expect(buildHostNamingNote(result, "compact")).toBe(
        EXHAUSTED_REVERSE_DNS_COMPACT_NOTE,
      );

      const message: string = buildScanStatusMessage(result, 3);

      if (overBy <= 0) {
        expect(message).toBe(bodyThenNote(body, EXHAUSTED_REVERSE_DNS_NOTE));
        expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH + overBy);
      } else {
        expect(message).toBe(
          bodyThenNote(body, EXHAUSTED_REVERSE_DNS_COMPACT_NOTE),
        );
        expect(message).not.toContain(REVERSE_DNS_BUDGET_ENV_VAR);
      }

      expect(message).not.toContain("…");
    }
  });

  /*
   * RUNG 2 and its boundary. With the full note out of reach, a body that
   * fits beside the COMPACT note to the character is printed byte for byte;
   * two characters more is the first body that is clipped below the headline.
   *
   * ONE character more is a case of its own — see the pinned window below.
   */
  test("the compact note keeps the body whole up to exactly the column, and two characters more clip below the headline", () => {
    const compactNote: string = EXHAUSTED_REVERSE_DNS_COMPACT_NOTE;
    const errorLength: number = exactFitErrorLength(compactNote);

    for (const overBy of [-1, 0, 2, 3]) {
      const result: SubnetScanResult = makeBoundaryResult(errorLength + overBy);
      const body: string = buildScanStatusMessage(
        withoutNamingOutcomes(result),
        3,
      );

      expect(body.length + 2 + compactNote.length).toBe(
        STATUS_MESSAGE_COLUMN_LENGTH + overBy,
      );
      // The full note is well out of reach on every case here.
      expect(
        body.length + 2 + EXHAUSTED_REVERSE_DNS_NOTE.length,
      ).toBeGreaterThan(STATUS_MESSAGE_COLUMN_LENGTH);
      expect(body.startsWith(`${BOUNDARY_HEADLINE} `)).toBe(true);

      const message: string = buildScanStatusMessage(result, 3);

      if (overBy <= 0) {
        // Byte for byte: the quoted error the operator needs is all there.
        expect(message).toBe(bodyThenNote(body, compactNote));
        expect(message).toContain(
          `most common: ${result.mostCommonSnmpError!}`,
        );
        expect(message).not.toContain("…");
      } else {
        const middle: string = clippedMiddleOf(
          message,
          BOUNDARY_HEADLINE,
          compactNote,
        );

        expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
        expect(middle.endsWith("…")).toBe(true);
        expect(
          body
            .slice(BOUNDARY_HEADLINE.length + 1)
            .startsWith(middle.slice(0, -1)),
        ).toBe(true);
        expect(countEllipses(message)).toBe(1);
      }
    }
  });

  /*
   * The one-character window between rung 2 and rung 3, pinned because it used
   * to be the one length at which the note did NOT survive whole.
   *
   * The room rung 3 leaves for the sweep's own sentences counts two characters
   * between them and the note, but the body's last sentence has no terminal
   * punctuation here - it ends with the device's own quoted SNMP error - so
   * joinBeforeNote inserts a full stop and needs three. The rest used to fit
   * the room WHOLE, the message came to 501, and the final guard took the
   * note's last characters and marked them with an ellipsis: "... not looked
   * u…". finishStatusMessage now composes again one character tighter when
   * that happens, so the cut lands on the sweep's own last sentence, which is
   * what rung 3 exists to give up.
   */
  test("one character over the compact rung, the cut lands on the body and the note survives whole", () => {
    const compactNote: string = EXHAUSTED_REVERSE_DNS_COMPACT_NOTE;
    const result: SubnetScanResult = makeBoundaryResult(
      exactFitErrorLength(compactNote) + 1,
    );
    const body: string = buildScanStatusMessage(
      withoutNamingOutcomes(result),
      3,
    );

    // The premise: one character over, with the whole body still in hand.
    expect(body.length + 2 + compactNote.length).toBe(
      STATUS_MESSAGE_COLUMN_LENGTH + 1,
    );

    const message: string = buildScanStatusMessage(result, 3);

    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
    // The note - the part nothing else in the product says - is intact.
    expect(message.endsWith(compactNote)).toBe(true);
    // The headline is whole, and the quoted error is what gave way.
    expect(message.startsWith(BOUNDARY_HEADLINE)).toBe(true);
    expect(countEllipses(message)).toBe(1);
    expect(message).not.toContain(
      `most common: ${result.mostCommonSnmpError!}`,
    );
  });

  /*
   * RUNG 3 on the SNMP path. The sweeps that run naming out of time are the
   * large, busy ones, and those are exactly the sweeps whose own sentences
   * fill the column: ICMP filtered, a quoted SNMP error, a crowded credential
   * summary. The headline survives whole, the rest is clipped with ONE
   * ellipsis, and the compact note is whole at the end.
   *
   * The SNMP-error sentence and the "nothing answered" checklist cannot fire
   * together (the checklist requires zero error hosts), so the crowded body is
   * built both ways; and the note both ways too — one without an excerpt, one
   * whose compact sentences carry excerpted reasons of their own.
   */
  test("a crowded SNMP body keeps its headline whole, is clipped once, and ends with the whole compact note", () => {
    const configs: Array<SubnetScanSnmpConfig> = makeTenCrowdedConfigs();

    const crowdedResults: Array<{
      result: SubnetScanResult;
      snmpResponderCount: number;
      headline: string;
    }> = [
      {
        result: makeResult({
          scannedHostCount: 4096,
          respondedToPingCount: 4096,
          icmpFilteredFallbackHostCount: 4096,
          snmpErrorHostCount: 4096,
          scannedPorts: [161, 1161],
          mostCommonSnmpError: LONG_SNMP_ERROR,
          responderCountByConfigId: { "config-0": 12 },
        }),
        snmpResponderCount: 12,
        headline: snmpHeadline(4096, 4096, 12),
      },
      {
        result: makeResult({
          scannedHostCount: 4096,
          respondedToPingCount: 0,
          icmpFilteredFallbackHostCount: 4096,
          snmpErrorHostCount: 0,
          scannedPorts: [161, 1161],
          responderCountByConfigId: {},
        }),
        snmpResponderCount: 0,
        headline: snmpHeadline(4096, 0, 0),
      },
    ];

    const noteOutcomes: Array<Partial<SubnetScanResult>> = [
      {
        reverseDnsOutcome: makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
        }),
      },
      {
        reverseDnsOutcome: makeReverseDnsOutcome({
          namedAddressCount: 0,
          error: LONG_RESOLVER_ERROR,
        }),
        netbiosOutcome: makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          isHostCapReached: true,
          error: LONG_SOCKET_REASON,
        }),
      },
    ];

    for (const crowded of crowdedResults) {
      for (const outcomes of noteOutcomes) {
        const result: SubnetScanResult = { ...crowded.result, ...outcomes };

        const body: string = buildScanStatusMessage(
          withoutNamingOutcomes(result),
          crowded.snmpResponderCount,
          configs,
        );
        const fullNote: string = buildHostNamingNote(result);
        const compactNote: string = buildHostNamingNote(result, "compact");

        // The premises: neither form fits beside the body, and the body has no ellipsis of its own.
        expect(body.length + 1 + fullNote.length).toBeGreaterThan(
          STATUS_MESSAGE_COLUMN_LENGTH,
        );
        expect(body.length + 1 + compactNote.length).toBeGreaterThan(
          STATUS_MESSAGE_COLUMN_LENGTH,
        );
        expect(
          countEllipses(body.substring(0, STATUS_MESSAGE_COLUMN_LENGTH - 1)),
        ).toBe(0);

        const message: string = buildScanStatusMessage(
          result,
          crowded.snmpResponderCount,
          configs,
        );
        const middle: string = clippedMiddleOf(
          message,
          crowded.headline,
          compactNote,
        );

        /*
         * Inside the column, and close to it: the fit stops at a sentence it
         * cannot keep whole, so the message is as long as the sentences that
         * DID fit allow rather than exactly the column.
         */
        expect(message.length).toBeLessThanOrEqual(
          STATUS_MESSAGE_COLUMN_LENGTH,
        );
        expect(message.length).toBeGreaterThan(
          STATUS_MESSAGE_COLUMN_LENGTH - 60,
        );
        // The body's cut is marked, once, immediately ahead of the note.
        expect(middle.endsWith("…")).toBe(true);
        expect(middle.length).toBeGreaterThanOrEqual(
          MIN_CLIPPED_SENTENCE_TAIL_LENGTH,
        );
        expect(countEllipses(message)).toBe(1 + countEllipses(compactNote));
        // What survived of the rest is the head of the rest.
        expect(
          body
            .slice(crowded.headline.length + 1)
            .startsWith(middle.slice(0, -1)),
        ).toBe(true);
        expect(message).not.toContain("s3cret-community");
      }
    }
  });

  /*
   * A full note longer than the 300 characters the previous design reserved
   * for it is no longer cut to a slice: beside a short body it is printed
   * whole, and beside a crowded one it gives way to the compact note rather
   * than losing its tail.
   */
  test("a long full note is printed whole when it fits, and otherwise gives way to its compact form intact", () => {
    /*
     * A thrown reverse-DNS pass with an excerpted reason, and the NetBIOS cap
     * with the knob that raises it: over 300 characters of note, and still
     * short enough to sit beside a bare headline. (A third sentence on top of
     * these two no longer fits beside anything — see the reviewer's scenario
     * below, which is exactly that case.)
     */
    const outcomes: Partial<SubnetScanResult> = {
      reverseDnsOutcome: makeReverseDnsOutcome({
        namedAddressCount: 0,
        error: LONG_RESOLVER_ERROR,
      }),
      netbiosOutcome: makeNetbiosOutcome({
        unnamedAddressCount: 3500,
        eligibleAddressCount: 3500,
        isHostCapReached: true,
      }),
    };

    const shortResult: SubnetScanResult = makeResult({
      respondedToPingCount: 12,
      ...outcomes,
    });
    const fullNote: string = buildHostNamingNote(shortResult);
    const compactNote: string = buildHostNamingNote(shortResult, "compact");

    expect(fullNote.length).toBeGreaterThan(300);

    const headline: string = snmpHeadline(254, 12, 3);

    expect(buildScanStatusMessage(shortResult, 3)).toBe(
      `${headline} ${fullNote}`,
    );

    const crowdedMessage: string = buildScanStatusMessage(
      makeResult({
        scannedHostCount: 4096,
        respondedToPingCount: 4096,
        icmpFilteredFallbackHostCount: 4096,
        snmpErrorHostCount: 4096,
        mostCommonSnmpError: LONG_SNMP_ERROR,
        responderCountByConfigId: { "config-0": 12 },
        ...outcomes,
      }),
      12,
      makeTenCrowdedConfigs(),
    );

    expect(crowdedMessage.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(crowdedMessage.endsWith(` ${compactNote}`)).toBe(true);
    expect(crowdedMessage.startsWith(`${snmpHeadline(4096, 4096, 12)} `)).toBe(
      true,
    );
    expect(
      crowdedMessage.charAt(
        STATUS_MESSAGE_COLUMN_LENGTH - compactNote.length - 2,
      ),
    ).toBe("…");
  });

  /*
   * The ICMP-only essential sentences are the caveat AND the headline, and
   * the room left for the advice after them and the compact note is steered
   * below to the character through the length of a quoted socket reason
   * (compact reasons are at most 40 characters, so each extra character of
   * reason is one less of room).
   *
   * Every case here is the 572-character "stopped early and nothing
   * answered" body, which SubnetScanner cannot produce, carrying outcomes for
   * hosts that did not answer; the tight-room branches are only reachable
   * with inputs like these, and are asserted because the column guarantee
   * has to hold on them anyway.
   */
  const ROOM_ESSENTIAL: string = `${ICMP_STOPPED_EARLY_CAVEAT} ${icmpOnlyHeadline(32768, 0)}`;

  // No spaces or periods, so a cut at any length is the reason as quoted.
  const ROOM_STEERING_REASON: string =
    "bind-EADDRNOTAVAIL-udp4-port137-interface-eth0-unreachable-from-container";

  /*
   * `isAbsurdlyLarge` buys a LONGER compact note — every count in it is
   * printed with its grouping commas — and so a smaller room. A realistic
   * 20,000-address pass leaves between 21 and 60 characters of room across the
   * reason lengths; the counts below are what it takes to squeeze the room
   * down to the single digits the tail branches live in.
   */
  function makeRoomSteeringResult(
    socketReasonLength: number,
    isAbsurdlyLarge: boolean,
  ): SubnetScanResult {
    const addressCount: number = isAbsurdlyLarge ? 1000000000000000 : 20000;

    return makeIcmpOnlyResult({
      scannedHostCount: 32768,
      respondedToPingCount: 0,
      isIcmpSweepIncomplete: true,
      reverseDnsOutcome: makeReverseDnsOutcome({
        resolvedCount: 0,
        addressCount: addressCount,
        namedAddressCount: 0,
        notLookedUpAddressCount: addressCount - 3000,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: 250000,
      }),
      netbiosOutcome: makeNetbiosOutcome({
        resolvedCount: 0,
        unnamedAddressCount: 18800,
        namedAddressCount: 0,
        eligibleAddressCount: 18800,
        queriedAddressCount: 0,
        isHostCapReached: true,
        isTimeBudgetExhausted: true,
        failureReason: ROOM_STEERING_REASON.substring(0, socketReasonLength),
      }),
    });
  }

  // The room between the essential sentences and the note, as the ladder counts it.
  function roomFor(result: SubnetScanResult): number {
    return (
      STATUS_MESSAGE_COLUMN_LENGTH -
      ROOM_ESSENTIAL.length -
      buildHostNamingNote(result, "compact").length -
      2
    );
  }

  function findRoomSteeringResult(
    targetRoom: number,
    isAbsurdlyLarge: boolean,
  ): SubnetScanResult {
    for (
      let length: number = 1;
      length <= MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH;
      length++
    ) {
      const result: SubnetScanResult = makeRoomSteeringResult(
        length,
        isAbsurdlyLarge,
      );

      if (roomFor(result) === targetRoom) {
        return result;
      }
    }

    throw new Error(`No socket reason length leaves a room of ${targetRoom}.`);
  }

  test("the room steering is sound: essential sentences and the advice are the real ones", () => {
    const result: SubnetScanResult = makeRoomSteeringResult(10, false);

    expect(
      buildScanStatusMessage(withoutNamingOutcomes(result), 0).startsWith(
        `${ROOM_ESSENTIAL} ${ICMP_NOTHING_ANSWERED_ADVICE.substring(0, 100)}`,
      ),
    ).toBe(true);
    expect(ROOM_STEERING_REASON.length).toBeGreaterThan(
      MAX_COMPACT_NAMING_REASON_EXCERPT_LENGTH,
    );
    // One more character of reason is one less of room.
    expect(roomFor(makeRoomSteeringResult(11, false))).toBe(
      roomFor(result) - 1,
    );
  });

  /*
   * The tail boundary. Twenty characters of the advice is the shortest tail
   * worth keeping, so a room of exactly 20 keeps 19 characters and the
   * ellipsis; a room of 19 keeps nothing but a lone ellipsis between the
   * essential sentences and the note — a dozen characters of a sentence say
   * nothing and read as a typo.
   */
  test("a room of exactly 20 keeps a 20-character tail, and a room of 19 leaves a lone ellipsis", () => {
    const atMinimum: SubnetScanResult = findRoomSteeringResult(
      MIN_CLIPPED_SENTENCE_TAIL_LENGTH,
      true,
    );
    const atMinimumNote: string = buildHostNamingNote(atMinimum, "compact");
    const atMinimumMessage: string = buildScanStatusMessage(atMinimum, 0);
    const tail: string = clippedMiddleOf(
      atMinimumMessage,
      ROOM_ESSENTIAL,
      atMinimumNote,
    );

    expect(atMinimumMessage.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(tail.length).toBe(MIN_CLIPPED_SENTENCE_TAIL_LENGTH);
    expect(tail.endsWith("…")).toBe(true);
    expect(ICMP_NOTHING_ANSWERED_ADVICE.startsWith(tail.slice(0, -1))).toBe(
      true,
    );

    const belowMinimum: SubnetScanResult = findRoomSteeringResult(
      MIN_CLIPPED_SENTENCE_TAIL_LENGTH - 1,
      true,
    );
    const belowMinimumNote: string = buildHostNamingNote(
      belowMinimum,
      "compact",
    );
    const belowMinimumMessage: string = buildScanStatusMessage(belowMinimum, 0);

    expect(belowMinimumMessage).toBe(`${ROOM_ESSENTIAL} … ${belowMinimumNote}`);
    expect(belowMinimumMessage.length).toBeLessThan(
      STATUS_MESSAGE_COLUMN_LENGTH,
    );
    expect(countEllipses(belowMinimumMessage)).toBe(1);
  });

  test("a room of a single character still marks the cut with a lone ellipsis", () => {
    const result: SubnetScanResult = findRoomSteeringResult(1, true);
    const message: string = buildScanStatusMessage(result, 0);

    expect(message).toBe(
      `${ROOM_ESSENTIAL} … ${buildHostNamingNote(result, "compact")}`,
    );
    expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
  });

  /*
   * No room at all: the rest is dropped, and what remains — the essential
   * sentences and the compact note — is joined by a single space and still
   * inside the column. Past that, the final guard clips the note's tail
   * rather than exceed the column; nothing the sweep produces gets there.
   */
  test("no room drops the rest entirely, and the final guard still holds the column past that", () => {
    for (const room of [0, -1]) {
      const result: SubnetScanResult = findRoomSteeringResult(room, true);
      const message: string = buildScanStatusMessage(result, 0);

      expect(message).toBe(
        `${ROOM_ESSENTIAL} ${buildHostNamingNote(result, "compact")}`,
      );
      expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH - 1 - room);
      expect(message).not.toContain("…");
    }

    const overflowing: SubnetScanResult = findRoomSteeringResult(-2, true);
    const overflowingMessage: string = buildScanStatusMessage(overflowing, 0);

    expect(overflowingMessage.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(overflowingMessage.startsWith(`${ROOM_ESSENTIAL} `)).toBe(true);
    expect(overflowingMessage.endsWith("…")).toBe(true);
  });

  /*
   * fitSentences: the rest of the body is fitted SENTENCE BY SENTENCE, not as
   * one clip of the joined text.
   *
   * The difference is what the operator is left holding. Clipping the joined
   * text puts the cut wherever the arithmetic lands - a message could end
   * "Answer…", the first seven characters of "Answered by credentials: ..." -
   * which says strictly less than dropping that sentence and marking the cut.
   * So whole sentences are kept while they fit, the FIRST one that does not is
   * kept only if enough of it survives to be read, and nothing is printed after
   * it: a later sentence on the far side of the ellipsis would read as the
   * clipped text rather than as what followed it.
   *
   * The SNMP path is where this is visible, because its rest is four sentences:
   * the ICMP-filtered note, the quoted SNMP error, and the two credential
   * sentences. Room is fixed here (the headline and a socket-failure note are
   * both constant); what moves is the length of the quoted error, and with it
   * how much of the NEXT sentence is left over.
   */
  const FIT_HEADLINE: string = snmpHeadline(4096, 4096, 12);
  const FIT_FILTERED_SENTENCE: string =
    "No host answered SNMP among those that replied to ICMP, so all 4096 ICMP-silent hosts were probed over SNMP as well " +
    "(ICMP is likely filtered on this network).";
  const FIT_ERROR_PREFIX: string =
    "4096 host(s) replied with an SNMP error rather than silence; most common: ";
  const FIT_ANSWERED_SENTENCE: string =
    "Answered by credentials: Core switches (V3) on 12.";
  const FIT_SILENT_SENTENCE: string =
    "No host answered: Access switches (V2c).";
  const FIT_COMPACT_NOTE: string =
    "NetBIOS socket failed (bind-EADDRNOTAVAIL-u).";

  function makeFitResult(errorLength: number): SubnetScanResult {
    return makeResult({
      scannedHostCount: 4096,
      respondedToPingCount: 4096,
      icmpFilteredFallbackHostCount: 4096,
      snmpErrorHostCount: 4096,
      mostCommonSnmpError: textOfLength(BOUNDARY_ERROR_PHRASE, errorLength),
      responderCountByConfigId: { "config-0": 12 },
      netbiosOutcome: makeNetbiosOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        queriedAddressCount: 0,
        failureReason: ROOM_STEERING_REASON.substring(0, 20),
      }),
    });
  }

  const FIT_CONFIGS: Array<SubnetScanSnmpConfig> = [
    makeSnmpConfig({ id: "config-0", label: "Core switches (V3)" }),
    makeSnmpConfig({ id: "config-1", label: "Access switches (V2c)" }),
  ];

  // The room the ladder leaves the four sentences, as it counts it.
  const FIT_ROOM: number =
    STATUS_MESSAGE_COLUMN_LENGTH -
    FIT_HEADLINE.length -
    FIT_COMPACT_NOTE.length -
    2;

  /*
   * The quoted-error length that leaves exactly `remaining` characters for the
   * sentence AFTER the error one: the room, less the filtered sentence and the
   * space after it, less the error sentence's own prefix, less the space
   * before what comes next.
   */
  function errorLengthLeaving(remaining: number): number {
    return (
      FIT_ROOM -
      FIT_FILTERED_SENTENCE.length -
      1 -
      FIT_ERROR_PREFIX.length -
      1 -
      remaining
    );
  }

  function fitErrorSentence(errorLength: number): string {
    return `${FIT_ERROR_PREFIX}${textOfLength(BOUNDARY_ERROR_PHRASE, errorLength)}`;
  }

  // The premise every case below rests on: these are the builder's sentences.
  test("the fitted sentences are the ones the sweep really prints", () => {
    const result: SubnetScanResult = makeFitResult(20);

    expect(
      buildScanStatusMessage(withoutNamingOutcomes(result), 12, FIT_CONFIGS),
    ).toBe(
      [
        FIT_HEADLINE,
        FIT_FILTERED_SENTENCE,
        fitErrorSentence(20),
        FIT_ANSWERED_SENTENCE,
        FIT_SILENT_SENTENCE,
      ].join(" "),
    );
    expect(buildHostNamingNote(result, "compact")).toBe(FIT_COMPACT_NOTE);
    expect(FIT_ROOM).toBe(393);
  });

  /*
   * Twenty characters of the next sentence is the least worth keeping, so a
   * remainder of exactly 20 keeps 19 of it and the ellipsis — and the sentence
   * after THAT is not printed at all.
   */
  test("whole sentences are kept, and the first that does not fit is clipped to a readable opening", () => {
    const errorLength: number = errorLengthLeaving(
      MIN_CLIPPED_SENTENCE_TAIL_LENGTH,
    );
    const message: string = buildScanStatusMessage(
      makeFitResult(errorLength),
      12,
      FIT_CONFIGS,
    );

    expect(message).toBe(
      `${FIT_HEADLINE} ${FIT_FILTERED_SENTENCE} ${fitErrorSentence(errorLength)} ` +
        `${FIT_ANSWERED_SENTENCE.substring(0, MIN_CLIPPED_SENTENCE_TAIL_LENGTH - 1)}… ${FIT_COMPACT_NOTE}`,
    );
    expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(countEllipses(message)).toBe(1);
    // Nothing from beyond the cut.
    expect(message).not.toContain(FIT_SILENT_SENTENCE);
  });

  /*
   * One character less, and the opening is not worth printing: a lone ellipsis
   * stands for the rest, and the message ends up SHORTER than the column
   * rather than padded with a fragment.
   */
  test("a remainder one short of twenty leaves a lone ellipsis, and nothing after it", () => {
    const errorLength: number = errorLengthLeaving(
      MIN_CLIPPED_SENTENCE_TAIL_LENGTH - 1,
    );
    const message: string = buildScanStatusMessage(
      makeFitResult(errorLength),
      12,
      FIT_CONFIGS,
    );

    expect(message).toBe(
      `${FIT_HEADLINE} ${FIT_FILTERED_SENTENCE} ${fitErrorSentence(errorLength)} … ${FIT_COMPACT_NOTE}`,
    );
    expect(message.length).toBeLessThan(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(countEllipses(message)).toBe(1);
    expect(message).not.toContain("Answered by credentials");
    expect(message).not.toContain(FIT_SILENT_SENTENCE);
  });

  /*
   * A remainder of a single character, and of none: the first still marks the
   * cut, the second leaves the kept sentences to speak for themselves — and
   * the second is also where the full stop before the note is needed, because
   * the last thing kept is the quoted error.
   */
  test("a remainder of one character marks the cut, and a remainder of none says nothing", () => {
    const oneLeft: number = errorLengthLeaving(1);
    const oneLeftMessage: string = buildScanStatusMessage(
      makeFitResult(oneLeft),
      12,
      FIT_CONFIGS,
    );

    expect(oneLeftMessage).toBe(
      `${FIT_HEADLINE} ${FIT_FILTERED_SENTENCE} ${fitErrorSentence(oneLeft)} … ${FIT_COMPACT_NOTE}`,
    );
    expect(oneLeftMessage.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);

    const noneLeft: number = errorLengthLeaving(0);
    const noneLeftMessage: string = buildScanStatusMessage(
      makeFitResult(noneLeft),
      12,
      FIT_CONFIGS,
    );

    expect(noneLeftMessage).toBe(
      `${FIT_HEADLINE} ${FIT_FILTERED_SENTENCE} ${fitErrorSentence(noneLeft)}. ${FIT_COMPACT_NOTE}`,
    );
    expect(noneLeftMessage.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(noneLeftMessage).not.toContain("…");
  });

  /*
   * And when it is the FIRST sentence of the rest that does not fit, the same
   * rule applies one sentence earlier: its opening is kept, and the three
   * sentences behind it are gone rather than shuffled forward into the gap.
   */
  test("a sentence that does not fit is clipped where it stands, not skipped for a shorter one", () => {
    const remainingForError: number =
      FIT_ROOM - FIT_FILTERED_SENTENCE.length - 1;
    const errorLength: number = remainingForError - FIT_ERROR_PREFIX.length + 1;
    const errorSentence: string = fitErrorSentence(errorLength);
    const message: string = buildScanStatusMessage(
      makeFitResult(errorLength),
      12,
      FIT_CONFIGS,
    );

    // The premise: one character too long to be kept whole.
    expect(errorSentence.length).toBe(remainingForError + 1);

    expect(message).toBe(
      `${FIT_HEADLINE} ${FIT_FILTERED_SENTENCE} ` +
        `${errorSentence.substring(0, remainingForError - 1)}… ${FIT_COMPACT_NOTE}`,
    );
    expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(countEllipses(message)).toBe(1);
    // The shorter credential sentences did not take the room the error left.
    expect(message).not.toContain("Answered by credentials");
    expect(message).not.toContain(FIT_SILENT_SENTENCE);
  });

  /*
   * The ladder's invariants over a wide, seeded grid of bodies and outcomes:
   * every message fits; a note is always WHOLE at the end in one of its two
   * forms; the essential sentences always lead whole; the full note is used
   * whenever it fits, the compact one only when the full one does not, and a
   * clip only when neither does — and a clip is a tail of the rest ending in
   * an ellipsis, or a lone ellipsis, or nothing.
   */
  test("over a seeded grid of bodies and outcomes, every message obeys the ladder", () => {
    const random: () => number = makeSeededRandom(3677);
    const reverseDnsGrid: Array<GridEntry<ReverseDnsNamingOutcome>> =
      reverseDnsOutcomeGrid();
    const netbiosGrid: Array<GridEntry<NetbiosNamingOutcome>> =
      netbiosOutcomeGrid();
    const labelPhrase: string = "Core distribution and access switches ";
    const errorPhrase: string =
      "Report PDU usmStatsWrongDigests from agent 10.1.2.3:161; ";
    let silentCount: number = 0;
    let fullCount: number = 0;
    let compactCount: number = 0;
    let clippedCount: number = 0;
    let overflowCount: number = 0;

    for (let iteration: number = 0; iteration < 400; iteration++) {
      /*
       * Both grids open with their two silent entries (no pass, a complete
       * pass). Drawn uniformly, a pair of them would come up about once in
       * two thousand draws, so one draw in ten is steered there on purpose.
       */
      const isSilentPair: boolean = random() < 0.1;
      const reverseDns: ReverseDnsNamingOutcome | undefined = pickOne(
        random,
        isSilentPair ? reverseDnsGrid.slice(0, 2) : reverseDnsGrid,
      ).outcome;
      const netbios: NetbiosNamingOutcome | undefined = pickOne(
        random,
        isSilentPair ? netbiosGrid.slice(0, 2) : netbiosGrid,
      ).outcome;

      let result: SubnetScanResult;
      let snmpResponderCount: number = 0;
      const snmpConfigs: Array<SubnetScanSnmpConfig> = [];
      let essential: string;

      if (random() < 0.35) {
        const scannedHostCount: number = pickOne(random, [254, 4096, 32768]);
        const answered: number = pickOne(random, [0, 0, 3, 20000]);
        const isIncomplete: boolean = random() < 0.6;

        result = makeIcmpOnlyResult({
          scannedHostCount: scannedHostCount,
          respondedToPingCount: answered,
          isIcmpSweepIncomplete: isIncomplete,
          reverseDnsOutcome: reverseDns,
          netbiosOutcome: netbios,
        });
        essential = isIncomplete
          ? `${ICMP_STOPPED_EARLY_CAVEAT} ${icmpOnlyHeadline(scannedHostCount, answered)}`
          : icmpOnlyHeadline(scannedHostCount, answered);
      } else {
        const scannedHostCount: number = pickOne(random, [1, 254, 4096, 32768]);
        const respondedToPingCount: number | undefined = pickOne(random, [
          undefined,
          0,
          12,
          4096,
        ]);
        const snmpErrorHostCount: number = pickOne(random, [0, 0, 2, 4096]);
        const configCount: number = pickOne(random, [0, 0, 2, 4, 10]);
        const responderCountByConfigId: Record<string, number> = {};

        snmpResponderCount = pickOne(random, [0, 0, 3, 4096]);

        for (let index: number = 0; index < configCount; index++) {
          snmpConfigs.push(
            makeSnmpConfig({
              id: `grid-${index}`,
              label: textOfLength(labelPhrase, 5 + Math.floor(random() * 96)),
            }),
          );

          if (random() < 0.3) {
            responderCountByConfigId[`grid-${index}`] =
              1 + Math.floor(random() * 50);
          }
        }

        result = makeResult({
          scannedHostCount: scannedHostCount,
          respondedToPingCount: respondedToPingCount,
          icmpFilteredFallbackHostCount: pickOne(random, [0, 0, 4096]),
          snmpErrorHostCount: snmpErrorHostCount,
          mostCommonSnmpError:
            random() < 0.8
              ? textOfLength(errorPhrase, 1 + Math.floor(random() * 120))
              : undefined,
          scannedPorts: pickOne(random, [[161], [161, 1161], []]),
          responderCountByConfigId: responderCountByConfigId,
          reverseDnsOutcome: reverseDns,
          netbiosOutcome: netbios,
        });
        essential = snmpHeadline(
          scannedHostCount,
          respondedToPingCount,
          snmpResponderCount,
        );
      }

      const noteless: string = buildScanStatusMessage(
        withoutNamingOutcomes(result),
        snmpResponderCount,
        snmpConfigs,
      );
      const fullNote: string = buildHostNamingNote(result, "full");
      const compactNote: string = buildHostNamingNote(result, "compact");
      const message: string = buildScanStatusMessage(
        result,
        snmpResponderCount,
        snmpConfigs,
      );

      /*
       * How the ladder joins a whole body to a note: one space, and a full
       * stop first when the body's last sentence has none — the SNMP-error
       * sentence ends with the quoted error itself. Mirrored here because the
       * rung a message lands on is decided by the joined LENGTH; the rule
       * itself is asserted on real messages in its own describe below.
       */
      const gap: number = ".!?…".includes(noteless.charAt(noteless.length - 1))
        ? 1
        : 2;

      const joinedWith: (note: string) => string = (note: string): string => {
        return `${noteless}${gap === 2 ? "." : ""} ${note}`;
      };

      expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
      expect(message.startsWith(essential)).toBe(true);

      if (!fullNote) {
        silentCount++;
        expect(message).toBe(noteless);
        continue;
      }

      if (
        noteless.length + gap + fullNote.length <=
        STATUS_MESSAGE_COLUMN_LENGTH
      ) {
        fullCount++;
        expect(message).toBe(joinedWith(fullNote));
        continue;
      }

      if (
        noteless.length + gap + compactNote.length <=
        STATUS_MESSAGE_COLUMN_LENGTH
      ) {
        compactCount++;
        expect(message).toBe(joinedWith(compactNote));
        continue;
      }

      clippedCount++;

      /*
       * The note is whole at the end of every clipped message but the
       * one-character window pinned above, where the room the ladder leaves
       * does not allow for the full stop it then inserts and the final guard
       * takes the note's last character. Counted rather than asserted away,
       * and still held to the column and to a clip of what the ladder
       * assembled — either the whole body and the note, or the essential
       * sentences and the note with the rest dropped.
       */
      if (!message.endsWith(` ${compactNote}`)) {
        overflowCount++;

        expect(message.length).toBe(STATUS_MESSAGE_COLUMN_LENGTH);
        expect(
          [joinedWith(compactNote), `${essential} ${compactNote}`].map(
            (assembled: string) => {
              return `${assembled.substring(0, STATUS_MESSAGE_COLUMN_LENGTH - 1)}…`;
            },
          ),
        ).toContain(message);
        continue;
      }

      const middle: string = clippedMiddleOf(message, essential, compactNote);
      const restHead: string = noteless.slice(essential.length + 1);

      if (middle.length > 1) {
        expect(middle.length).toBeGreaterThanOrEqual(
          MIN_CLIPPED_SENTENCE_TAIL_LENGTH,
        );
        /*
         * A clipped tail ends in the ellipsis; a tail kept WHOLE ends in the
         * full stop the join added to it, and is the head of the rest either
         * way.
         */
        expect(middle.endsWith("…") || middle.endsWith(".")).toBe(true);
        expect(
          restHead.startsWith(
            middle.endsWith("…") ? middle.slice(0, -1) : middle,
          ) || restHead.startsWith(middle.slice(0, -1)),
        ).toBe(true);
      } else {
        expect(["", "…"]).toContain(middle);
      }
    }

    // Guard on the guard: every rung of the ladder was actually exercised.
    expect(silentCount).toBeGreaterThan(0);
    expect(fullCount).toBeGreaterThan(15);
    expect(compactCount).toBeGreaterThan(15);
    expect(clippedCount).toBeGreaterThan(15);
    // And the pinned window is the rarity it is claimed to be, not the rule.
    expect(overflowCount).toBeLessThan(clippedCount / 4);
  });
});

/*
 * joinBeforeNote (FetchScans.ts): the sweep's sentences and the note, with a
 * full stop between them when the sweep's last sentence has none.
 *
 * Only one sentence the sweep prints ends without punctuation, and it is the
 * one that matters most: "...most common: Authentication failure" ends with
 * the device's own error text. Without the stop the note ran straight on from
 * it — "...most common: Authentication failure Reverse DNS named 1,200..." —
 * and the note read as part of the quoted error, which is exactly the sentence
 * an operator is trying to read carefully.
 */
describe("buildScanStatusMessage — a full stop between the sweep and the note", () => {
  // No periods, so a cut at any length still ends without punctuation.
  const JOIN_ERROR_PHRASE: string =
    "Report PDU usmStatsUnknownEngineIDs from agent 10-20-30-40:161 during engine discovery; ";

  const JOIN_HEADLINE: string = snmpHeadline(254, 12, 3);

  function makeJoinResult(error: string): SubnetScanResult {
    return makeResult({
      respondedToPingCount: 12,
      snmpErrorHostCount: 2,
      mostCommonSnmpError: error,
      reverseDnsOutcome: makeReverseDnsOutcome({
        notLookedUpAddressCount: 2700,
        isTimeBudgetExhausted: true,
      }),
    });
  }

  test("the stop is inserted on the full-note rung", () => {
    const error: string = "Authentication failure";
    const result: SubnetScanResult = makeJoinResult(error);
    const body: string = buildScanStatusMessage(
      withoutNamingOutcomes(result),
      3,
    );

    // The premises: the body really ends with the error, and the full note fits.
    expect(body.endsWith(`most common: ${error}`)).toBe(true);
    expect(
      body.length + 2 + EXHAUSTED_REVERSE_DNS_NOTE.length,
    ).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);

    const message: string = buildScanStatusMessage(result, 3);

    expect(message).toBe(`${body}. ${EXHAUSTED_REVERSE_DNS_NOTE}`);
    expect(message).toContain(`most common: ${error}. Reverse DNS named`);
  });

  test("the stop is inserted on the compact-note rung too", () => {
    const error: string = textOfLength(JOIN_ERROR_PHRASE, 220);
    const result: SubnetScanResult = makeJoinResult(error);
    const body: string = buildScanStatusMessage(
      withoutNamingOutcomes(result),
      3,
    );

    // The premises: the full note no longer fits beside this body, the compact one does.
    expect(body.length + 2 + EXHAUSTED_REVERSE_DNS_NOTE.length).toBeGreaterThan(
      STATUS_MESSAGE_COLUMN_LENGTH,
    );
    expect(
      body.length + 2 + EXHAUSTED_REVERSE_DNS_COMPACT_NOTE.length,
    ).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);

    const message: string = buildScanStatusMessage(result, 3);

    expect(message).toBe(`${body}. ${EXHAUSTED_REVERSE_DNS_COMPACT_NOTE}`);
    expect(message).toContain(
      `${error}. ${EXHAUSTED_REVERSE_DNS_COMPACT_NOTE}`,
    );
  });

  /*
   * After a clip there is nothing to add: the clipped tail already ends in an
   * ellipsis, which is terminal punctuation as far as the join is concerned.
   * A stop after it would read as a fifth dot.
   */
  test("a clipped body ends in its ellipsis, with no stop added after it", () => {
    const result: SubnetScanResult = makeResult({
      scannedHostCount: 4096,
      respondedToPingCount: 4096,
      icmpFilteredFallbackHostCount: 4096,
      snmpErrorHostCount: 4096,
      mostCommonSnmpError: LONG_SNMP_ERROR,
      responderCountByConfigId: { "config-0": 12 },
      reverseDnsOutcome: makeReverseDnsOutcome({
        notLookedUpAddressCount: 2700,
        isTimeBudgetExhausted: true,
      }),
    });
    const compactNote: string = buildHostNamingNote(result, "compact");
    const message: string = buildScanStatusMessage(
      result,
      12,
      makeTenCrowdedConfigs(),
    );

    // The premise: this one really is clipped, with the note whole at the end.
    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(message).not.toBe(
      buildScanStatusMessage(
        withoutNamingOutcomes(result),
        12,
        makeTenCrowdedConfigs(),
      ),
    );
    expect(message.endsWith(` ${compactNote}`)).toBe(true);

    expect(message.charAt(message.length - compactNote.length - 2)).toBe("…");
    expect(message).not.toContain(".… ");
    expect(countEllipses(message)).toBe(1);
  });

  /*
   * Bodies that already end in a sentence get nothing added. Checked on all
   * three of the endings the sweep produces — the headline, the ICMP-only
   * advice, and a quoted error that ends in its own punctuation.
   */
  test("a body that already ends in a full stop gets no second one", () => {
    const reverseDns: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      notLookedUpAddressCount: 2700,
      isTimeBudgetExhausted: true,
    });

    // The bare headline.
    expect(
      buildScanStatusMessage(
        makeResult({ respondedToPingCount: 12, reverseDnsOutcome: reverseDns }),
        3,
      ),
    ).toBe(`${JOIN_HEADLINE} ${EXHAUSTED_REVERSE_DNS_NOTE}`);

    // The ICMP-only advice, which is the longest sentence the sweep prints.
    const icmpOnly: string = buildScanStatusMessage(
      makeIcmpOnlyResult({ reverseDnsOutcome: reverseDns }),
      0,
    );

    expect(icmpOnly).toContain(`answered ping. ${EXHAUSTED_REVERSE_DNS_NOTE}`);
    expect(icmpOnly).not.toContain("..");

    // An error the device ended itself.
    for (const error of ["Authentication failure.", "Timeout!", "Who?"]) {
      const message: string = buildScanStatusMessage(makeJoinResult(error), 3);

      expect(message).toContain(
        `most common: ${error} ${EXHAUSTED_REVERSE_DNS_NOTE}`,
      );
      expect(message).not.toContain(`${error}. `);
    }
  });

  // And with no note at all, the message is exactly the body, stop or no stop.
  test("a body with no note to join keeps its own ending", () => {
    const result: SubnetScanResult = makeJoinResult("Authentication failure");

    expect(buildHostNamingNote(withoutNamingOutcomes(result))).toBe("");
    expect(
      buildScanStatusMessage(withoutNamingOutcomes(result), 3).endsWith(
        "most common: Authentication failure",
      ),
    ).toBe(true);
  });
});

/*
 * The scenarios the review of the previous design found, as regressions. In
 * each, the old composition (a note reserved up to 300 characters, the body
 * clipped from its END to make room) lost the one thing the operator needed.
 */
describe("buildScanStatusMessage — the reviewer's scenarios", () => {
  /*
   * A /17 ping sweep that stopped early after confirming 20,000 hosts, whose
   * reverse DNS ran out of time and whose NetBIOS lookup hit its cap. Caveat
   * and headline are 290 characters, the full note over 250: under the old
   * reservation the body was clipped from its end to fit beside the note, and
   * that end was the HEADLINE, cut off before "20000 answered ping" — the one
   * number the whole message is about.
   */
  test("an incomplete ICMP-only sweep with reverse DNS out of time and the NetBIOS cap keeps '20000 answered ping' whole", () => {
    const result: SubnetScanResult = makeIcmpOnlyResult({
      scannedHostCount: 32768,
      respondedToPingCount: 20000,
      isIcmpSweepIncomplete: true,
      reverseDnsOutcome: makeReverseDnsOutcome({
        addressCount: 20000,
        notLookedUpAddressCount: 17000,
        isTimeBudgetExhausted: true,
      }),
      netbiosOutcome: makeNetbiosOutcome({
        unnamedAddressCount: 18800,
        eligibleAddressCount: 18800,
        queriedAddressCount: 2000,
        isHostCapReached: true,
      }),
    });
    const headline: string = icmpOnlyHeadline(32768, 20000);
    const body: string = `${ICMP_STOPPED_EARLY_CAVEAT} ${headline}`;
    const compactNote: string =
      "Reverse DNS hit its 10m limit; 17,000 of 20,000 hosts not looked up. " +
      "NetBIOS skipped 16,800 hosts over its 2,000-host cap.";

    // The premise: the full note does not fit beside these two sentences.
    expect(
      body.length + 1 + buildHostNamingNote(result).length,
    ).toBeGreaterThan(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(buildHostNamingNote(result, "compact")).toBe(compactNote);

    const message: string = buildScanStatusMessage(result, 0);

    expect(message).toBe(`${body} ${compactNote}`);
    expect(message).toContain(": 20000 answered ping.");
    expect(message).not.toContain("…");
  });

  /*
   * A probe whose resolver refuses connections, on a range big enough for the
   * NetBIOS cap, whose NetBIOS socket then never bound. The full note is three
   * sentences and over 400 characters, so the old 300-character slice cut its
   * LAST sentence — the socket failure, the one fact that says why NetBIOS
   * named nothing. The compact note keeps every sentence and its reason.
   */
  test("a broken resolver, the NetBIOS cap and a bind timeout keep the NetBIOS failure reason visible", () => {
    const outcomes: Partial<SubnetScanResult> = {
      reverseDnsOutcome: makeReverseDnsOutcome({
        resolvedCount: 0,
        addressCount: 4096,
        namedAddressCount: 0,
        notLookedUpAddressCount: 4064,
        isReverseDnsAvailable: false,
        isTimeBudgetExhausted: true,
        failureReason: BROKEN_RESOLVER_REASON,
      }),
      netbiosOutcome: makeNetbiosOutcome({
        resolvedCount: 0,
        unnamedAddressCount: 4096,
        namedAddressCount: 0,
        eligibleAddressCount: 4096,
        queriedAddressCount: 0,
        isHostCapReached: true,
        isTimeBudgetExhausted: true,
        failureReason: BIND_TIMEOUT_REASON,
      }),
    };

    // Beside a crowded body: the compact note, reason and all, whole at the end.
    const crowded: SubnetScanResult = makeResult({
      scannedHostCount: 4096,
      respondedToPingCount: 0,
      icmpFilteredFallbackHostCount: 4096,
      scannedPorts: [161, 1161],
      ...outcomes,
    });
    const fullNote: string = buildHostNamingNote(crowded);

    expect(fullNote.length).toBeGreaterThan(400);

    const crowdedMessage: string = buildScanStatusMessage(
      crowded,
      0,
      makeFourEstateConfigs(),
    );

    expect(crowdedMessage.length).toBeLessThanOrEqual(
      STATUS_MESSAGE_COLUMN_LENGTH,
    );
    expect(crowdedMessage.startsWith(`${snmpHeadline(4096, 0, 0)} `)).toBe(
      true,
    );
    expect(
      crowdedMessage.endsWith(
        ` Reverse DNS got no answers (${BROKEN_RESOLVER_REASON}). ` +
          "NetBIOS skipped 2,096 hosts over its 2,000-host cap. " +
          "NetBIOS socket failed (The UDP socket did not bind in time).",
      ),
    ).toBe(true);

    /*
     * Beside the bare headline, all three FULL sentences are now too long to
     * fit: the cap sentence carries the knob that raises the cap, and those
     * sixty-odd characters are what takes this note past the column. The
     * compact note is used instead — and the socket failure and its reason,
     * the fact this scenario is about, survive whole either way.
     */
    const shortMessage: string = buildScanStatusMessage(
      makeResult({ respondedToPingCount: 12, ...outcomes }),
      3,
    );
    const compactNote: string = buildHostNamingNote(crowded, "compact");

    expect(
      snmpHeadline(254, 12, 3).length + 2 + fullNote.length,
    ).toBeGreaterThan(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(shortMessage).toBe(`${snmpHeadline(254, 12, 3)} ${compactNote}`);
    expect(
      shortMessage.endsWith(
        "NetBIOS socket failed (The UDP socket did not bind in time).",
      ),
    ).toBe(true);

    /*
     * And without the cap sentence — the same probe on a range under the cap —
     * the full note does fit, and says the lookups never ran at all rather
     * than that they stopped.
     */
    const underTheCap: SubnetScanResult = makeResult({
      respondedToPingCount: 12,
      ...outcomes,
      netbiosOutcome: makeNetbiosOutcome({
        resolvedCount: 0,
        unnamedAddressCount: 1500,
        namedAddressCount: 0,
        eligibleAddressCount: 1500,
        queriedAddressCount: 0,
        isTimeBudgetExhausted: true,
        failureReason: BIND_TIMEOUT_REASON,
      }),
    });

    expect(buildScanStatusMessage(underTheCap, 3)).toBe(
      `${snmpHeadline(254, 12, 3)} ${buildHostNamingNote(underTheCap)}`,
    );
    expect(
      buildScanStatusMessage(underTheCap, 3).endsWith(
        "NetBIOS lookups did not run because the probe's UDP socket failed (The UDP socket did not bind in time).",
      ),
    ).toBe(true);
  });

  /*
   * An SNMP sweep of four credentials that found nothing, on a probe whose
   * resolver is broken. The checklist is the operator's whole to-do list, and
   * under the old reservation its tail — "the devices' SNMP ACL allows the
   * probe's IP address" — was what the note's slice cost. The compact note
   * fits beside the whole body, so nothing of it is clipped.
   */
  test("an SNMP 'nothing answered' sweep with four credentials and a broken resolver keeps its checklist unclipped", () => {
    const result: SubnetScanResult = makeResult({
      scannedHostCount: 4096,
      respondedToPingCount: 0,
      scannedPorts: [161, 1161],
      reverseDnsOutcome: makeReverseDnsOutcome({
        resolvedCount: 0,
        addressCount: 4096,
        namedAddressCount: 0,
        notLookedUpAddressCount: 4064,
        isReverseDnsAvailable: false,
        isTimeBudgetExhausted: true,
        failureReason: BROKEN_RESOLVER_REASON,
      }),
    });
    const configs: Array<SubnetScanSnmpConfig> = makeFourEstateConfigs();
    const body: string = buildScanStatusMessage(
      withoutNamingOutcomes(result),
      0,
      configs,
    );
    const compactNote: string = `Reverse DNS got no answers (${BROKEN_RESOLVER_REASON}).`;
    const checklist: string =
      "Nothing answered SNMP on ports 161, 1161. Check that this probe can reach the range, " +
      "that UDP/161, 1161 is permitted to it, and that the devices' SNMP ACL allows the probe's IP address.";

    // The premises: the full note does not fit, the compact one does.
    expect(body.endsWith(checklist)).toBe(true);
    expect(
      body.length + 1 + buildHostNamingNote(result).length,
    ).toBeGreaterThan(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(buildHostNamingNote(result, "compact")).toBe(compactNote);

    const message: string = buildScanStatusMessage(result, 0, configs);

    expect(message).toBe(`${body} ${compactNote}`);
    expect(message).toContain(`${checklist} ${compactNote}`);
    expect(message).toContain(
      "No host answered: Core switches (V3), Access switches (V2c), Printers (V1), Vendor block (V2c).",
    );
    expect(message).not.toContain("…");
  });
});

describe("buildScanStatusMessage — nonsense and secrets beside the note", () => {
  /*
   * Unknown and nonsense counts on both outcomes, on both return paths. The
   * scanner sanitises what the resolvers report, but this builder is the
   * last stop before an operator's screen, and "NaN hosts" or "undefined
   * time limit" there would read as a probe that does not know what it did.
   */
  test("unknown or nonsense counts never render as NaN, undefined or Infinity", () => {
    const outcomes: Partial<SubnetScanResult> = {
      reverseDnsOutcome: makeReverseDnsOutcome({
        namedAddressCount: NaN,
        notLookedUpAddressCount: NaN,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: NaN,
      }),
      netbiosOutcome: makeNetbiosOutcome({
        namedAddressCount: NaN,
        eligibleAddressCount: undefined,
        queriedAddressCount: NaN,
        maxHosts: undefined,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: Infinity,
      }),
    };

    const messages: Array<string> = [
      buildScanStatusMessage(
        makeResult({ respondedToPingCount: 12, ...outcomes }),
        3,
      ),
      buildScanStatusMessage(makeIcmpOnlyResult({ ...outcomes }), 0),
      buildHostNamingNote(makeResult({ ...outcomes }), "compact"),
    ];

    for (const message of messages) {
      expect(message).not.toContain("NaN");
      expect(message).not.toContain("undefined");
      expect(message).not.toContain("Infinity");
      expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
    }

    for (const message of messages.slice(0, 2)) {
      expect(message).toContain(
        "Reverse DNS named 0 of 4,000 hosts before its time limit",
      );
      expect(message).toContain(
        "NetBIOS named 0 of 1,500 hosts before its time limit.",
      );
    }

    expect(messages[2]).toBe(
      "Reverse DNS hit its time limit after naming 0 of 4,000 hosts. " +
        /*
         * The FULL NetBIOS sentence: with no budget figure the compact frame
         * is the longer of the two, so shorterNoteForm hands this one back.
         */
        "NetBIOS named 0 of 1,500 hosts before its time limit.",
    );
  });

  /*
   * statusMessage is readable by roles deliberately denied the credential
   * columns. The note is new text on that message, built beside the
   * credential summary, so the no-secret guarantee is re-asserted with it in
   * place — including when every clip fires.
   */
  test("no community string reaches the message when a note is present", () => {
    const configs: Array<SubnetScanSnmpConfig> = makeTenCrowdedConfigs();

    const results: Array<SubnetScanResult> = [
      makeResult({
        respondedToPingCount: 20,
        responderCountByConfigId: { "config-0": 12, "config-3": 8 },
        reverseDnsOutcome: makeReverseDnsOutcome({
          notLookedUpAddressCount: 2700,
          isTimeBudgetExhausted: true,
        }),
      }),
      makeResult({
        scannedHostCount: 4096,
        respondedToPingCount: 0,
        icmpFilteredFallbackHostCount: 4096,
        scannedPorts: [161, 1161],
        reverseDnsOutcome: makeReverseDnsOutcome({
          namedAddressCount: 0,
          error: LONG_RESOLVER_ERROR,
        }),
        netbiosOutcome: makeNetbiosOutcome({
          unnamedAddressCount: 3500,
          eligibleAddressCount: 3500,
          isHostCapReached: true,
          failureReason: LONG_SOCKET_REASON,
        }),
      }),
    ];

    for (const result of results) {
      const message: string = buildScanStatusMessage(result, 20, configs);

      expect(buildHostNamingNote(result).length).toBeGreaterThan(0);
      expect(message).not.toContain("s3cret-community");
      expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
    }
  });
});

/*
 * OneUptime issue #3916 — "hosts named by IP, and nothing says why".
 *
 * An ICMP-only scan of twelve kitchen displays named four of them by reverse
 * DNS. The other eight were listed by address under a message that said only
 * "12 answered ping", because the note reported a reverse-DNS problem only
 * when the pass threw, ran out of time, or found the resolver unusable — and
 * "unusable" takes 64 failures in a row with no answer at all. Lookups that
 * timed out for SOME hosts on a small scan were invisible, and read exactly
 * like addresses with no PTR record. So was a NetBIOS lookup the scan asked
 * for and a global probe refused to send.
 *
 * Two sentences close those gaps. Both are pinned here in their full and
 * compact forms, against the rules every other sentence of the note obeys.
 */

/*
 * The failure sentence, written out whole rather than built from the
 * builder's own pieces, so a change to its wording has to be made here too.
 */
function failedLookupsNote(failedOfTotal: string): string {
  return (
    `Reverse DNS lookups failed for ${failedOfTotal}; ` +
    "hover the (i) beside an unnamed host for the reason, and rescan to try again."
  );
}

function failedLookupsCompactNote(failedOfTotal: string): string {
  return `Reverse DNS failed for ${failedOfTotal}; rescan to retry.`;
}

const NETBIOS_GLOBAL_PROBE_NOTE: string =
  "NetBIOS names were not looked up: this is a global probe, and global probes never send NetBIOS queries.";

const NETBIOS_GLOBAL_PROBE_COMPACT_NOTE: string =
  "NetBIOS skipped: this is a global probe.";

// The reported scan's outcome: 12 hosts, 4 named, 2 lookups that failed.
function makeCustomerReverseDnsOutcome(
  overrides?: Partial<ReverseDnsNamingOutcome>,
): ReverseDnsNamingOutcome {
  return makeReverseDnsOutcome({
    resolvedCount: 4,
    addressCount: 12,
    namedAddressCount: 4,
    totalBudgetInMs: 60000,
    failedAddressCount: 2,
    ...overrides,
  });
}

describe("buildHostNamingNote — reverse DNS lookups that failed (#3916)", () => {
  test("says how many of how many failed, where to read why, and the fix", () => {
    const outcome: ReverseDnsNamingOutcome = makeCustomerReverseDnsOutcome();

    expect(noteFor(outcome)).toBe(failedLookupsNote("2 of 12 hosts"));
    expect(compactNoteFor(outcome)).toBe(
      failedLookupsCompactNote("2 of 12 hosts"),
    );
  });

  test("every lookup failed reads 'all N hosts', and a one-host sweep 'the one host'", () => {
    /*
     * "12 of 12 hosts" says the same thing less plainly; and "1 of 1 host"
     * reads like a typo. Both are the resolver answering for nobody, below
     * the 64 failures that would have called it unusable.
     */
    const allFailed: ReverseDnsNamingOutcome = makeCustomerReverseDnsOutcome({
      resolvedCount: 0,
      namedAddressCount: 0,
      failedAddressCount: 12,
    });
    const oneHost: ReverseDnsNamingOutcome = makeCustomerReverseDnsOutcome({
      resolvedCount: 0,
      addressCount: 1,
      namedAddressCount: 0,
      failedAddressCount: 1,
    });

    expect(noteFor(allFailed)).toBe(failedLookupsNote("all 12 hosts"));
    expect(compactNoteFor(allFailed)).toBe(
      failedLookupsCompactNote("all 12 hosts"),
    );
    expect(noteFor(oneHost)).toBe(failedLookupsNote("the one host"));
    expect(compactNoteFor(oneHost)).toBe(
      failedLookupsCompactNote("the one host"),
    );
  });

  test("counts are grouped by thousands, and the total keeps its own plural", () => {
    expect(
      noteFor(
        makeReverseDnsOutcome({
          resolvedCount: 1200,
          addressCount: 20000,
          namedAddressCount: 1200,
          failedAddressCount: 1024,
        }),
      ),
    ).toBe(failedLookupsNote("1,024 of 20,000 hosts"));
    // "1 of 12 hosts": the count of failures is not what "hosts" agrees with.
    expect(
      noteFor(makeCustomerReverseDnsOutcome({ failedAddressCount: 1 })),
    ).toBe(failedLookupsNote("1 of 12 hosts"));
  });

  test("zero, missing or nonsense failure counts say nothing, in either form", () => {
    for (const failed of [
      0,
      undefined,
      NaN,
      -3,
      Infinity,
      -Infinity,
      "2",
      null,
      0.5,
    ]) {
      const outcome: ReverseDnsNamingOutcome = makeCustomerReverseDnsOutcome({
        failedAddressCount: failed as unknown as number,
      });

      expect(`${String(failed)}: ${noteFor(outcome)}`).toBe(
        `${String(failed)}: `,
      );
      expect(`${String(failed)}: ${compactNoteFor(outcome)}`).toBe(
        `${String(failed)}: `,
      );
    }
  });

  test("a fractional count is floored rather than printed", () => {
    expect(
      noteFor(makeCustomerReverseDnsOutcome({ failedAddressCount: 2.9 })),
    ).toBe(failedLookupsNote("2 of 12 hosts"));
  });

  test("the count is clamped to the addresses left unnamed, and a pass that named everyone says nothing", () => {
    /*
     * A named address did not fail. The scanner bounds the figure the same
     * way; this is the builder refusing to print "50 of 12" from any caller.
     */
    expect(
      noteFor(makeCustomerReverseDnsOutcome({ failedAddressCount: 50 })),
    ).toBe(failedLookupsNote("8 of 12 hosts"));
    expect(
      noteFor(
        makeCustomerReverseDnsOutcome({
          resolvedCount: 12,
          namedAddressCount: 12,
          failedAddressCount: 5,
        }),
      ),
    ).toBe("");
    // With nobody named, the clamp is the whole pass: "any of", not "13 of 12".
    expect(
      noteFor(
        makeCustomerReverseDnsOutcome({
          resolvedCount: 0,
          namedAddressCount: 0,
          failedAddressCount: 13,
        }),
      ),
    ).toBe(failedLookupsNote("all 12 hosts"));
  });

  test("a pass that threw says only that it threw", () => {
    const outcome: ReverseDnsNamingOutcome = makeCustomerReverseDnsOutcome({
      error: "name table went away",
    });

    expect(noteFor(outcome)).toBe(
      "Reverse DNS lookups failed on this probe (name table went away) after naming 4 of 12 hosts.",
    );
    expect(compactNoteFor(outcome)).toBe(
      "Reverse DNS failed (name table went away).",
    );
  });

  test("a resolver judged unusable says only that, and a verdict with names still reports its failures", () => {
    const unusable: ReverseDnsNamingOutcome = makeCustomerReverseDnsOutcome({
      resolvedCount: 0,
      namedAddressCount: 0,
      isReverseDnsAvailable: false,
      failureReason: "queryPtr ETIMEOUT",
      failedAddressCount: 12,
    });

    expect(noteFor(unusable)).toBe(
      "Reverse DNS lookups from this probe got no answers (queryPtr ETIMEOUT), so none of the 12 hosts got a reverse DNS name - " +
        "check the probe's DNS resolver and the reverse DNS zone for this range.",
    );
    expect(compactNoteFor(unusable)).toBe(
      "Reverse DNS got no answers (queryPtr ETIMEOUT).",
    );

    /*
     * "Unavailable" with names is a double reporting both, which the note
     * already reads as "not unusable" (see the no-answers describe above). Its
     * failures are then as real as anyone's.
     */
    expect(
      noteFor(makeCustomerReverseDnsOutcome({ isReverseDnsAvailable: false })),
    ).toBe(failedLookupsNote("2 of 12 hosts"));
  });

  test("beside the time limit, both are said, the time limit first, in both forms", () => {
    const outcome: ReverseDnsNamingOutcome = makeReverseDnsOutcome({
      notLookedUpAddressCount: 2700,
      isTimeBudgetExhausted: true,
      failedAddressCount: 50,
    });

    expect(noteFor(outcome)).toBe(
      `${EXHAUSTED_REVERSE_DNS_NOTE} ${failedLookupsNote("50 of 4,000 hosts")}`,
    );
    expect(compactNoteFor(outcome)).toBe(
      `${EXHAUSTED_REVERSE_DNS_COMPACT_NOTE} ${failedLookupsCompactNote("50 of 4,000 hosts")}`,
    );
  });

  test("then NetBIOS, after a single space", () => {
    const note: string = noteFor(
      makeCustomerReverseDnsOutcome(),
      makeNetbiosOutcome({
        unnamedAddressCount: 3500,
        eligibleAddressCount: 3500,
        queriedAddressCount: 2000,
        isHostCapReached: true,
      }),
    );

    expect(note).toBe(
      `${failedLookupsNote("2 of 12 hosts")} ${NETBIOS_CAP_NOTE}`,
    );
  });

  test("the compact form is strictly shorter and keeps only the count and the fix", () => {
    const outcomes: Array<ReverseDnsNamingOutcome> = [
      makeCustomerReverseDnsOutcome(),
      makeCustomerReverseDnsOutcome({
        resolvedCount: 0,
        namedAddressCount: 0,
        failedAddressCount: 12,
      }),
      makeReverseDnsOutcome({
        addressCount: 65534,
        failedAddressCount: 65534 - 1200,
      }),
    ];

    for (const outcome of outcomes) {
      const full: string = noteFor(outcome);
      const compact: string = compactNoteFor(outcome);

      expect(compact.length).toBeLessThan(full.length);
      expect(compact).not.toContain("(i)");
      expect(compact).not.toContain("retry;");
      expect(compact).not.toContain(REVERSE_DNS_BUDGET_ENV_VAR);
      expect(compact.endsWith("rescan to retry.")).toBe(true);
    }
  });

  test("never claims hosts are listed by address, and never quotes one resolver reason for a mix of failures", () => {
    /*
     * A host whose lookup failed can still be named by SNMP or NetBIOS, so
     * the sentence is about reverse DNS only. And the resolver's reason is
     * its FIRST failure: beside a count of failures that may be timeouts,
     * SERVFAILs and REFUSEDs at once, quoting one would misdescribe the rest.
     * Each host's own code, in its tooltip, is the per-host reason.
     */
    const outcome: ReverseDnsNamingOutcome = makeCustomerReverseDnsOutcome({
      failureReason: "queryPtr ESERVFAIL 52.42.16.10.in-addr.arpa",
    });

    for (const note of [noteFor(outcome), compactNoteFor(outcome)]) {
      expect(note).not.toContain("listed by");
      expect(note).not.toContain("ESERVFAIL");
      expect(note).not.toContain("in-addr.arpa");
    }
  });
});

describe("buildHostNamingNote — NetBIOS skipped on a global probe (#3916)", () => {
  test("says the lookup did not run and why, in full and compact", () => {
    const result: SubnetScanResult = makeResult({
      isNetbiosLookupSkippedOnGlobalProbe: true,
    });

    expect(buildHostNamingNote(result)).toBe(NETBIOS_GLOBAL_PROBE_NOTE);
    expect(buildHostNamingNote(result, "compact")).toBe(
      NETBIOS_GLOBAL_PROBE_COMPACT_NOTE,
    );
    expect(NETBIOS_GLOBAL_PROBE_COMPACT_NOTE.length).toBeLessThan(
      NETBIOS_GLOBAL_PROBE_NOTE.length,
    );
  });

  test("only a literal true is a skip", () => {
    for (const flag of [false, undefined, null, "true", 1, {}]) {
      const result: SubnetScanResult = makeResult({
        isNetbiosLookupSkippedOnGlobalProbe: flag as unknown as boolean,
      });

      expect(`${String(flag)}: ${buildHostNamingNote(result)}`).toBe(
        `${String(flag)}: `,
      );
      expect(`${String(flag)}: ${buildHostNamingNote(result, "compact")}`).toBe(
        `${String(flag)}: `,
      );
    }
  });

  test("a lookup that ran is described by its own verdict, whatever the flag says", () => {
    /*
     * The two cannot both be true of one sweep. If a caller says they are,
     * the verdict is the record of a lookup that actually happened — so a
     * complete one stays silent and a capped one reports its cap.
     */
    expect(
      buildHostNamingNote(
        makeResult({
          isNetbiosLookupSkippedOnGlobalProbe: true,
          netbiosOutcome: makeNetbiosOutcome(),
        }),
      ),
    ).toBe("");
    expect(
      buildHostNamingNote(
        makeResult({
          isNetbiosLookupSkippedOnGlobalProbe: true,
          netbiosOutcome: makeNetbiosOutcome({
            unnamedAddressCount: 3500,
            eligibleAddressCount: 3500,
            queriedAddressCount: 2000,
            isHostCapReached: true,
          }),
        }),
      ),
    ).toBe(NETBIOS_CAP_NOTE);
  });

  test("comes after the reverse-DNS half, in both forms", () => {
    const result: SubnetScanResult = makeResult({
      reverseDnsOutcome: makeCustomerReverseDnsOutcome(),
      isNetbiosLookupSkippedOnGlobalProbe: true,
    });

    expect(buildHostNamingNote(result)).toBe(
      `${failedLookupsNote("2 of 12 hosts")} ${NETBIOS_GLOBAL_PROBE_NOTE}`,
    );
    expect(buildHostNamingNote(result, "compact")).toBe(
      `${failedLookupsCompactNote("2 of 12 hosts")} ${NETBIOS_GLOBAL_PROBE_COMPACT_NOTE}`,
    );
  });

  test("across the whole reverse-DNS grid: never silent, compact no longer than full, and always last", () => {
    let pairs: number = 0;

    for (const entry of reverseDnsOutcomeGrid()) {
      const result: SubnetScanResult = makeResult({
        reverseDnsOutcome: entry.outcome,
        isNetbiosLookupSkippedOnGlobalProbe: true,
      });
      const full: string = buildHostNamingNote(result, "full");
      const compact: string = buildHostNamingNote(result, "compact");

      pairs++;

      expect(`${entry.name}: ${full.endsWith(NETBIOS_GLOBAL_PROBE_NOTE)}`).toBe(
        `${entry.name}: true`,
      );
      expect(
        `${entry.name}: ${compact.endsWith(NETBIOS_GLOBAL_PROBE_COMPACT_NOTE)}`,
      ).toBe(`${entry.name}: true`);
      expect(`${entry.name}: ${compact.length <= full.length}`).toBe(
        `${entry.name}: true`,
      );
      expect(compact).not.toContain("  ");
      expect(compact).not.toContain(REVERSE_DNS_BUDGET_ENV_VAR);
    }

    expect(pairs).toBeGreaterThan(40);
  });
});

describe("buildScanStatusMessage — the #3916 sentences on the message", () => {
  test("the reported scan: the headline, then the failure sentence", () => {
    /*
     * Before the fix this message was the headline alone — byte for byte
     * the customer's screenshot — whatever had happened to the eight hosts.
     */
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({
          scannedHostCount: 15,
          respondedToPingCount: 12,
          reverseDnsOutcome: makeCustomerReverseDnsOutcome(),
        }),
        0,
      ),
    ).toBe(`${icmpOnlyHeadline(15, 12)} ${failedLookupsNote("2 of 12 hosts")}`);
  });

  test("the reported scan on a global probe with NetBIOS ticked says both", () => {
    expect(
      buildScanStatusMessage(
        makeIcmpOnlyResult({
          scannedHostCount: 15,
          respondedToPingCount: 12,
          reverseDnsOutcome: makeCustomerReverseDnsOutcome(),
          isNetbiosLookupSkippedOnGlobalProbe: true,
        }),
        0,
      ),
    ).toBe(
      `${icmpOnlyHeadline(15, 12)} ${failedLookupsNote("2 of 12 hosts")} ${NETBIOS_GLOBAL_PROBE_NOTE}`,
    );
  });

  test("a sweep whose last sentence is a quoted SNMP error gets a full stop before either sentence", () => {
    for (const outcomes of [
      { reverseDnsOutcome: makeCustomerReverseDnsOutcome() },
      { isNetbiosLookupSkippedOnGlobalProbe: true },
    ] as Array<Partial<SubnetScanResult>>) {
      const message: string = buildScanStatusMessage(
        makeResult({
          respondedToPingCount: 12,
          snmpErrorHostCount: 2,
          mostCommonSnmpError: "Authentication failure",
          ...outcomes,
        }),
        3,
      );

      expect(message).toContain("most common: Authentication failure. ");
      expect(message).not.toContain("failure Reverse DNS");
      expect(message).not.toContain("failure NetBIOS");
    }
  });

  test("an incomplete ping sweep keeps its caveat and headline whole and falls to both compact sentences", () => {
    /*
     * The essential pair on this path is already over 280 characters, so the
     * two full sentences (about 250 more) cannot fit beside it, and the two
     * compact ones can. Nothing is clipped.
     */
    const result: SubnetScanResult = makeIcmpOnlyResult({
      scannedHostCount: 32768,
      respondedToPingCount: 20000,
      isIcmpSweepIncomplete: true,
      reverseDnsOutcome: makeReverseDnsOutcome({
        addressCount: 20000,
        failedAddressCount: 40,
      }),
      isNetbiosLookupSkippedOnGlobalProbe: true,
    });
    const essential: string = `${ICMP_STOPPED_EARLY_CAVEAT} ${icmpOnlyHeadline(32768, 20000)}`;
    const message: string = buildScanStatusMessage(result, 0);

    expect(
      essential.length + 1 + buildHostNamingNote(result, "full").length,
    ).toBeGreaterThan(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(message).toBe(
      `${essential} ${failedLookupsCompactNote("40 of 20,000 hosts")} ${NETBIOS_GLOBAL_PROBE_COMPACT_NOTE}`,
    );
    expect(countEllipses(message)).toBe(0);
    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
  });

  test("a crowded SNMP body is clipped once below its headline, with both compact sentences whole at the end", () => {
    const result: SubnetScanResult = makeResult({
      scannedHostCount: 4096,
      respondedToPingCount: 4096,
      icmpFilteredFallbackHostCount: 4096,
      snmpErrorHostCount: 4096,
      mostCommonSnmpError: LONG_SNMP_ERROR,
      scannedPorts: [161, 1161],
      responderCountByConfigId: { "config-0": 12 },
      reverseDnsOutcome: makeReverseDnsOutcome({
        addressCount: 4096,
        failedAddressCount: 300,
      }),
      isNetbiosLookupSkippedOnGlobalProbe: true,
    });
    const compactNote: string = `${failedLookupsCompactNote("300 of 4,096 hosts")} ${NETBIOS_GLOBAL_PROBE_COMPACT_NOTE}`;
    const message: string = buildScanStatusMessage(
      result,
      12,
      makeTenCrowdedConfigs(),
    );

    expect(buildHostNamingNote(result, "compact")).toBe(compactNote);
    expect(message.length).toBeLessThanOrEqual(STATUS_MESSAGE_COLUMN_LENGTH);
    expect(countEllipses(message)).toBe(1);

    const middle: string = clippedMiddleOf(
      message,
      snmpHeadline(4096, 4096, 12),
      compactNote,
    );

    expect(middle.endsWith("…")).toBe(true);
    expect(message).not.toContain("s3cret-community");
  });

  test("nonsense on the new fields never renders as NaN, undefined or Infinity", () => {
    for (const failed of [NaN, Infinity, -1, undefined]) {
      const messages: Array<string> = [
        buildScanStatusMessage(
          makeIcmpOnlyResult({
            reverseDnsOutcome: makeCustomerReverseDnsOutcome({
              failedAddressCount: failed,
              isTimeBudgetExhausted: true,
              notLookedUpAddressCount: NaN,
            }),
            isNetbiosLookupSkippedOnGlobalProbe: true,
          }),
          0,
        ),
        buildHostNamingNote(
          makeResult({
            reverseDnsOutcome: makeCustomerReverseDnsOutcome({
              failedAddressCount: failed,
            }),
          }),
          "compact",
        ),
      ];

      for (const message of messages) {
        expect(message).not.toContain("NaN");
        expect(message).not.toContain("undefined");
        expect(message).not.toContain("Infinity");
      }
    }
  });
});
