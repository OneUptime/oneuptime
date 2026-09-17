import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostFilter,
  DiscoveredHostFilterOption,
  getDiscoveredHostFilterEmptyMessage,
  getDiscoveredHostFilterLabel,
  getDiscoveredHostFilterOptions,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * Every string the SNMP / No SNMP filter (#3322) puts in front of an operator,
 * and the wiring in Discovery.tsx that puts it there.
 *
 * The filter shipped with a copy defect of exactly the kind nothing else in
 * the suite could catch. The empty-group line was built as
 *
 *     `No ${getDiscoveredHostFilterLabel(filter)} hosts in this scan.`
 *
 * and that label already returns "No SNMP", so the dialog read
 * "No No SNMP hosts in this scan." It is not an obscure path either: it is one
 * click away on any sweep where every host answered SNMP. The fix was to give
 * the empty state its own function, `getDiscoveredHostFilterEmptyMessage`,
 * instead of composing a button's noun phrase into a sentence frame.
 *
 * So this file pins two different things, and both are needed:
 *
 *   - The EXACT sentences and labels, so a reword is a deliberate act with a
 *     failing test attached rather than a silent one.
 *   - Properties that hold for ANY wording — no doubled word, no doubled
 *     negation, sentences punctuated as sentences, and an option label that is
 *     provably its own label plus its own count and nothing else. Those are
 *     what survive a legitimate rewrite and still catch the defect CLASS, and
 *     they run over every string the module can produce rather than only over
 *     the three the exact assertions name.
 *
 * The source-level half follows InventoryTableInvariants.test.ts: the App
 * suite runs in a plain Node environment with no React renderer, so the dialog
 * cannot be mounted and read. Comments are stripped so that describing a rule
 * in prose never counts as implementing it, and whitespace is squashed so
 * Prettier can reflow props without making the test brittle.
 */

const DISCOVERY_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "NetworkDevice",
  "Discovery.tsx",
);

/*
 * Read once per run, not once per helper call.
 *
 * The helpers below call this forty-odd times, twice inside a single test in
 * places, and the page they read is a file on disk that other processes edit —
 * a second agent, an editor, a rebase. An uncached read can hand two halves of
 * one test two different files and fail on a difference that never existed in
 * either version, which is a false red nobody can reproduce. The subject of a
 * source-level test has to hold still for the length of the run.
 */
let cachedSource: string | null = null;

function readSource(): string {
  if (cachedSource === null) {
    cachedSource = fs.readFileSync(DISCOVERY_PAGE, "utf8");
  }

  return cachedSource;
}

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The page with comments removed and whitespace squashed to single spaces. */
function readCode(): string {
  return squash(stripComments(readSource()));
}

/*
 * Slicing that refuses to hand back a lie.
 *
 * `String.indexOf` returns -1 for a miss, and `slice(-1, ...)` quietly yields
 * the tail of the file (or an empty string) rather than failing. Both turn a
 * `not.toContain` into a vacuous pass and a `toContain` into a check against
 * the whole page — which is how source-level tests rot into passing for the
 * wrong reason after a rename. Throwing here makes the rename a red test.
 */
function sliceBetween(data: {
  code: string;
  from: string;
  to?: string | undefined;
}): string {
  const start: number = data.code.indexOf(data.from);

  if (start === -1) {
    throw new Error(`Discovery.tsx no longer contains "${data.from}"`);
  }

  if (!data.to) {
    return data.code.slice(start);
  }

  const end: number = data.code.indexOf(data.to, start);

  if (end === -1) {
    throw new Error(
      `Discovery.tsx no longer contains "${data.to}" after "${data.from}"`,
    );
  }

  return data.code.slice(start, end);
}

/** Everything the Review Discovered Devices modal renders. */
function modalSection(): string {
  return sliceBetween({
    code: readCode(),
    from: 'title="Review Discovered Devices"',
  });
}

/** The sentence under the modal title, before the layout props. */
function descriptionSection(): string {
  return sliceBetween({
    code: readCode(),
    from: 'title="Review Discovered Devices"',
    to: "modalWidth={",
  });
}

/** The per-row checkbox, up to its change handler. */
function checkboxSection(): string {
  return sliceBetween({
    code: readCode(),
    from: "<CheckboxElement",
    to: "onChange={(value: boolean)",
  });
}

/** The "No SNMP" pill on a ping-only row. */
function pingOnlyBadgeSection(): string {
  return sliceBetween({
    code: readCode(),
    from: "{isPingOnly && (",
    to: "{entry.isAlreadyRegistered && (",
  });
}

const ALL_FILTERS: Array<DiscoveredHostFilter> = [
  DiscoveredHostFilter.All,
  DiscoveredHostFilter.Snmp,
  DiscoveredHostFilter.NoSnmp,
];

function snmpHost(ipAddress: string): DiscoveredNetworkDevice {
  return { ipAddress: ipAddress, snmpReachable: true };
}

function pingOnlyHost(ipAddress: string): DiscoveredNetworkDevice {
  return { ipAddress: ipAddress, snmpReachable: false };
}

/** A scan of a given shape, addresses spread over a /16 so none repeat. */
function scanOf(data: {
  snmpCount: number;
  pingOnlyCount: number;
}): Array<DiscoveredNetworkDevice> {
  const hosts: Array<DiscoveredNetworkDevice> = [];

  for (let index: number = 0; index < data.snmpCount; index++) {
    hosts.push(snmpHost(`10.1.${Math.floor(index / 256)}.${index % 256}`));
  }

  for (let index: number = 0; index < data.pingOnlyCount; index++) {
    hosts.push(pingOnlyHost(`10.2.${Math.floor(index / 256)}.${index % 256}`));
  }

  return hosts;
}

function labelsOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return getDiscoveredHostFilterOptions(hosts).map(
    (option: DiscoveredHostFilterOption) => {
      return option.label;
    },
  );
}

/*
 * Every string this module can render, across scan shapes that exercise each
 * group being empty, singular, and four digits long. The property tests below
 * run over this rather than over the three sentences the exact assertions
 * name, so a defect introduced in a BUTTON label — the empty message spliced
 * into one, say — is caught by the same rule that caught it in the sentence.
 */
function everyUserVisibleString(): Array<string> {
  const strings: Array<string> = [];

  for (const filter of ALL_FILTERS) {
    strings.push(getDiscoveredHostFilterLabel(filter));
    strings.push(getDiscoveredHostFilterEmptyMessage(filter));
  }

  const scans: Array<Array<DiscoveredNetworkDevice>> = [
    [],
    scanOf({ snmpCount: 1, pingOnlyCount: 0 }),
    scanOf({ snmpCount: 0, pingOnlyCount: 1 }),
    scanOf({ snmpCount: 3, pingOnlyCount: 4 }),
    scanOf({ snmpCount: 1000, pingOnlyCount: 0 }),
  ];

  for (const scan of scans) {
    strings.push(...labelsOf(scan));
  }

  return strings;
}

describe("the empty-group sentences", () => {
  test("each group says exactly what it says", () => {
    /*
     * The three sentences, verbatim. Note that none of them is the button's
     * noun phrase dropped into a frame: the SNMP one is not "No SNMP hosts in
     * this scan", and the ping-only one is phrased as what the sweep DID find
     * ("every host answered SNMP") rather than as the absence of a group,
     * because absence tells the operator nothing they can act on.
     */
    expect(
      getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.All),
    ).toEqual("This scan did not find any responding hosts.");

    expect(
      getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.Snmp),
    ).toEqual("No host in this scan answered SNMP.");

    expect(
      getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.NoSnmp),
    ).toEqual("Every host in this scan answered SNMP.");
  });

  test("no group's message is its button label dropped into a sentence frame", () => {
    /*
     * The shipped defect, stated as the rule it broke rather than as the one
     * string it produced. `No ${label} hosts in this scan.` is wrong for the
     * NoSnmp group specifically ("No No SNMP hosts...") but it is banned for
     * all three, because the moment ANY of them is built that way the next
     * label rename reintroduces the collision.
     */
    for (const filter of ALL_FILTERS) {
      const message: string = getDiscoveredHostFilterEmptyMessage(filter);

      for (const other of ALL_FILTERS) {
        const label: string = getDiscoveredHostFilterLabel(other);

        expect(message).not.toEqual(`No ${label} hosts in this scan.`);
        expect(message.toLowerCase()).not.toContain(
          `no ${label.toLowerCase()} hosts`,
        );
      }
    }
  });

  test("a sentence is punctuated as one and a button label is not", () => {
    /*
     * The empty message is rendered as a standalone paragraph and the label
     * as the text of a button, so they are different kinds of copy: one needs
     * a capital and a full stop, the other must not carry a trailing full
     * stop into a control. A label that grew one would be the first sign that
     * a sentence had been routed into the button row.
     */
    for (const filter of ALL_FILTERS) {
      const message: string = getDiscoveredHostFilterEmptyMessage(filter);

      expect(message.length).toBeGreaterThan(0);
      expect(message.slice(0, 1)).toEqual(message.slice(0, 1).toUpperCase());
      expect(message.endsWith(".")).toBe(true);
      expect(message.trim()).toEqual(message);

      const label: string = getDiscoveredHostFilterLabel(filter);

      expect(label.endsWith(".")).toBe(false);
      expect(label.trim()).toEqual(label);
    }
  });

  test("nothing the filter renders negates twice or repeats a word", () => {
    /*
     * The class-level guard, run over labels, sentences AND button labels at
     * several scan shapes. "No No SNMP" is the instance that shipped; the
     * general rule is that no string assembled from these parts may stutter,
     * which is what happens whenever one piece of copy is concatenated into
     * another that already contains it.
     */
    const doubledNegation: RegExp = /\bno\s+no\b/i;
    const doubledWord: RegExp = /\b([a-z]+)\s+\1\b/i;

    for (const value of everyUserVisibleString()) {
      expect(doubledNegation.test(value)).toBe(false);
      expect(doubledWord.test(value)).toBe(false);
    }
  });
});

describe("the group names", () => {
  test("the three groups are named exactly this", () => {
    expect(getDiscoveredHostFilterLabel(DiscoveredHostFilter.All)).toEqual(
      "All",
    );
    expect(getDiscoveredHostFilterLabel(DiscoveredHostFilter.Snmp)).toEqual(
      "SNMP",
    );
    expect(getDiscoveredHostFilterLabel(DiscoveredHostFilter.NoSnmp)).toEqual(
      "No SNMP",
    );
  });

  test("the No SNMP button is worded like the No SNMP pill on the row", () => {
    /*
     * The button filters TO the rows carrying that pill. If the two drift
     * into near-synonyms — "Ping only" on one and "No SNMP" on the other —
     * the operator has to work out that they are the same group, which is
     * exactly the connection the filter exists to make for them. Read from
     * the page rather than trusted, because the pill is hand-written JSX and
     * the button label comes from the module.
     */
    const badgeText: string = getDiscoveredHostFilterLabel(
      DiscoveredHostFilter.NoSnmp,
    );

    expect(pingOnlyBadgeSection()).toContain(`> ${badgeText} </span>`);
  });
});

describe("the filter buttons", () => {
  test("the buttons are always All, then SNMP, then No SNMP", () => {
    /*
     * Order is copy too: All is the default and the widest group, and the two
     * specific groups read in the same order as the sentence in the modal
     * description. Reordering would move the button under a cursor that has
     * learned where it is.
     */
    for (const hosts of [
      [],
      scanOf({ snmpCount: 0, pingOnlyCount: 5 }),
      scanOf({ snmpCount: 5, pingOnlyCount: 0 }),
      scanOf({ snmpCount: 2, pingOnlyCount: 3 }),
    ]) {
      expect(
        getDiscoveredHostFilterOptions(hosts).map(
          (option: DiscoveredHostFilterOption) => {
            return option.value;
          },
        ),
      ).toEqual([
        DiscoveredHostFilter.All,
        DiscoveredHostFilter.Snmp,
        DiscoveredHostFilter.NoSnmp,
      ]);
    }
  });

  test("counts read the way an operator checks them against the probe's tally", () => {
    /*
     * Zero renders as a zero rather than being hidden, one is not special,
     * and the separator appears at exactly four digits — 999 stays bare,
     * 1,000 is grouped. The last case is #3322's own sweep: 2,866 SNMP hosts
     * and 2,890 ping-only ones, where "2866" and "2,866" are not equally easy
     * to check against what the probe reported.
     */
    expect(labelsOf([])).toEqual(["All (0)", "SNMP (0)", "No SNMP (0)"]);

    expect(labelsOf(scanOf({ snmpCount: 1, pingOnlyCount: 0 }))).toEqual([
      "All (1)",
      "SNMP (1)",
      "No SNMP (0)",
    ]);

    expect(labelsOf(scanOf({ snmpCount: 0, pingOnlyCount: 999 }))).toEqual([
      "All (999)",
      "SNMP (0)",
      "No SNMP (999)",
    ]);

    expect(labelsOf(scanOf({ snmpCount: 0, pingOnlyCount: 1000 }))).toEqual([
      "All (1,000)",
      "SNMP (0)",
      "No SNMP (1,000)",
    ]);

    expect(labelsOf(scanOf({ snmpCount: 2866, pingOnlyCount: 2890 }))).toEqual([
      "All (5,756)",
      "SNMP (2,866)",
      "No SNMP (2,890)",
    ]);
  });

  test("a button's label is its own name and its own count, nothing else", () => {
    /*
     * The composition rule, asserted per option rather than as a literal, and
     * it does two jobs at once:
     *
     *   - The `count` field and the number IN the label are the same number.
     *     They are read by different things (the label by the operator, the
     *     count by any caller that wants the size), so a label built from the
     *     wrong group's count is invisible until someone compares them.
     *   - No label is ever assembled out of the empty-state sentence. That is
     *     the reverse of the shipped defect — one piece of copy composed into
     *     another — and it would produce a button reading
     *     "Every host in this scan answered SNMP. (0)".
     */
    for (const hosts of [
      [],
      scanOf({ snmpCount: 3, pingOnlyCount: 0 }),
      scanOf({ snmpCount: 0, pingOnlyCount: 7 }),
      scanOf({ snmpCount: 1200, pingOnlyCount: 41 }),
    ]) {
      for (const option of getDiscoveredHostFilterOptions(hosts)) {
        expect(option.label).toEqual(
          `${getDiscoveredHostFilterLabel(
            option.value,
          )} (${option.count.toLocaleString("en-US")})`,
        );

        for (const filter of ALL_FILTERS) {
          expect(option.label).not.toContain(
            getDiscoveredHostFilterEmptyMessage(filter),
          );
        }
      }
    }
  });
});

describe("the dialog puts that copy on screen", () => {
  test("the anchors every slice below depends on are still in the page", () => {
    /*
     * A rename that lost one would make the slices throw rather than silently
     * check the whole file. This test is where that is stated out loud, so
     * the failure names the anchor instead of turning up as an unrelated
     * assertion.
     */
    expect(modalSection().length).toBeGreaterThan(0);
    expect(descriptionSection().length).toBeGreaterThan(0);
    expect(checkboxSection().length).toBeGreaterThan(0);
    expect(pingOnlyBadgeSection().length).toBeGreaterThan(0);
  });

  test("both empty states are rendered through the shared message", () => {
    /*
     * There are two of them and they say different things: a scan that found
     * nothing at all (All, regardless of which filter happens to be active),
     * and a scan that found hosts but none in the group on screen (the ACTIVE
     * filter, which is the case the "No No SNMP" defect lived in). Both go
     * through the module so neither can be reworded on its own.
     */
    const section: string = modalSection();

    expect(section).toContain("reviewEntries.length === 0");
    expect(section).toContain(
      "getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.All)",
    );

    expect(section).toContain("shownEntries.length === 0");
    expect(section).toContain(
      "getDiscoveredHostFilterEmptyMessage(hostFilter)",
    );
  });

  test("the page never builds an empty state out of a button label again", () => {
    /*
     * The defect itself, banned at source. Any `No ${getDiscoveredHostFilterLabel(...)}`
     * is the collision returning, and the old frame's tail is banned with it
     * so the sentence cannot be reassembled around a different label call.
     */
    const code: string = readCode();

    const labelDroppedIntoNoFrame: RegExp =
      /no\s+\$\{\s*getDiscoveredHostFilterLabel/i;

    expect(labelDroppedIntoNoFrame.test(code)).toBe(false);
    expect(code).not.toContain("hosts in this scan.");
  });

  test("the description explains what each group imports as", () => {
    /*
     * It used to end "hosts without SNMP cannot be imported", which stopped
     * being true when ping-only hosts started importing as monitor-backed
     * devices — and which reads as a flat contradiction sitting directly
     * above a No SNMP filter whose whole purpose is importing them as a
     * batch. What replaced it has to be more than the removal: the two groups
     * import into different kinds of device, and that is the fact the
     * operator needs before choosing a filter.
     *
     * REPAIRED BY #3445, which weakened this test without editing a line of
     * it. The description became a ternary on the scan's mode, so
     * `descriptionSection()` now spans BOTH arms — and the two `toContain`s
     * below stopped saying anything about the SNMP sentence in particular.
     * They would pass unchanged if the SNMP arm lost both phrases and the
     * ICMP-only arm gained them, which is precisely the swap a new branch
     * makes easy. The positive half is therefore asked of the SNMP arm
     * itself. The bans stay on the whole section, because NEITHER sentence
     * may tell an operator a host cannot be imported by a dialog whose only
     * button imports it.
     */
    const description: string = descriptionSection();

    expect(description).not.toContain("cannot be imported");
    expect(description).not.toContain("without SNMP cannot");

    /*
     * The two groups no longer import into different KINDS of device — both
     * are Probe devices the scan's probe pings — so what the sentence has to
     * carry is the one difference left: SNMP hosts arrive with the scan's
     * credentials and are walked, hosts without SNMP are pinged until
     * credentials are added. "monitor-backed" and "polling off" would be
     * describing the import this dialog no longer does.
     */
    const snmpBranch: string = reviewDescriptionBranches().snmp;

    expect(snmpBranch).toContain("credentials");
    expect(snmpBranch).toContain("pinged by the scan's probe");
    expect(snmpBranch).not.toContain("monitor-backed");
    expect(snmpBranch).not.toContain("polling off");
  });

  test("a row's checkbox says which host it is for", () => {
    /*
     * See CategoryProps.ariaLabel in Common/UI/Components/Checkbox/Checkbox.tsx:
     * the box has no visible `title` beside it, so without an ariaLabel every
     * one of thousands of rows is announced as "checkbox" and nothing else.
     * The address is in the name because it is the selection key and the only
     * thing guaranteed to differ between rows — sysName is optional.
     */
    const checkbox: string = checkboxSection();

    expect(checkbox).toContain("ariaLabel={");
    expect(checkbox).toContain("entry.ipAddress");
    expect(checkbox).toContain('"no address"');
  });

  test("a checkbox that cannot be ticked says why", () => {
    /*
     * `hoverText` lands on the input's own title attribute, which on a
     * DISABLED box is the only place the reason can live — and a box that
     * cannot be ticked and does not say why reads as broken rather than as
     * deliberate. Both disabling reasons are covered: already imported, and
     * no address to import under.
     */
    const checkbox: string = checkboxSection();

    expect(checkbox).toContain("hoverText={");
    expect(checkbox).toContain('"Already added as a Network Device."');
    expect(checkbox).toContain(
      '"This host reported no address, so it cannot be imported."',
    );
  });
});

/*
 * THE ICMP-ONLY SWEEP (issue #3445)
 *
 * A discovery scan can now be run with Check SNMP off: a plain ICMP sweep that
 * sends no SNMP packet, asks for no credentials, and reports every host that
 * answered ping. Every string in this dialog was written when that was
 * impossible, and three of them are wrong on such a scan in a way that reads as
 * a failure rather than as a result:
 *
 *   - the description offers a choice between two groups the sweep cannot have;
 *   - the SNMP / No SNMP row shows two identical groups and one permanently
 *     empty button;
 *   - that empty button's message, "No host in this scan answered SNMP.", reads
 *     as rejected credentials on a scan that carried none.
 *
 * The first two are handled below. The third is handled by never showing the
 * button. The per-row pill is deliberately left exactly as it was — see the
 * last describe.
 */

interface ReviewDescriptionBranches {
  icmpOnly: string;
  snmp: string;
}

/*
 * The two halves of the description's ternary, as literals.
 *
 * Same refusal-to-lie contract as sliceBetween: a regex that no longer matches
 * would otherwise hand back empty strings, and every `toContain` below would
 * pass against nothing and every `not.toContain` would pass vacuously. If the
 * description stops being a ternary on the scan's mode, this must be the thing
 * that fails, by name.
 */
function reviewDescriptionBranches(): ReviewDescriptionBranches {
  const match: RegExpMatchArray | null = descriptionSection().match(
    /isIcmpOnlyReview \? "([^"]+)" : "([^"]+)"/,
  );

  if (!match || !match[1] || !match[2]) {
    throw new Error(
      "Discovery.tsx's Review description is no longer a ternary on isIcmpOnlyReview",
    );
  }

  return { icmpOnly: match[1], snmp: match[2] };
}

/*
 * Everything between the mode guard and the filter row it guards — which, if
 * the guard really does wrap that row, is nothing at all.
 */
function filterButtonsGuardSection(): string {
  return sliceBetween({
    code: readCode(),
    from: "{!isIcmpOnlyReview && (",
    to: "<FilterButtons",
  });
}

describe("the review dialog reads differently for a scan that only pinged", () => {
  test("the anchors the ICMP-only slices depend on are still in the page", () => {
    /*
     * Stated out loud, for the same reason the existing anchors test is: a
     * rename should fail here, naming the anchor, rather than turning up three
     * tests later as an assertion about copy that was never read.
     */
    expect(reviewDescriptionBranches().icmpOnly.length).toBeGreaterThan(0);
    expect(reviewDescriptionBranches().snmp.length).toBeGreaterThan(0);
    expect(filterButtonsGuardSection().length).toBeGreaterThan(0);
  });

  test("the mode this dialog branches on is read through ScanModeUtil", () => {
    /*
     * The single line everything else in this file hangs off:
     *
     *   const isIcmpOnlyReview: boolean = ScanModeUtil.isIcmpOnly(scanToReview);
     *
     * Every other assertion here is satisfied by ANY derivation of that
     * boolean — the guard is still around the row, both arms of the ternary
     * are still there, the pill is still ungated. So rewriting it to
     * `!scanToReview?.isSnmpEnabled` leaves this whole file green while
     * flipping every scan that has no value for the column — every scan
     * created before #3445, and every row read back through a `select` that
     * omits it — onto the ICMP-only copy: it is told it "checked ICMP only"
     * when it polled SNMP, and it loses the SNMP / No SNMP row it has always
     * had. Absence means SNMP, and the one place that rule is written is
     * ScanModeUtil's `!== false`.
     *
     * The second assertion is the same rule as a ban, so the mode cannot be
     * re-derived off the column somewhere further down the page either. All
     * three current mentions of the flag in this page are object KEYS (the
     * toggle's field, the value its onChange writes, and selectMoreFields);
     * a READ of it is a second copy of the rule by definition.
     */
    const code: string = readCode();

    expect(code).toContain(
      "const isIcmpOnlyReview: boolean = ScanModeUtil.isIcmpOnly(scanToReview);",
    );

    const modeReadOffTheColumn: RegExp = /[.?]\s*isSnmpEnabled/;

    expect(modeReadOffTheColumn.test(code)).toBe(false);
  });

  test("the description has a branch for a scan that sent no SNMP", () => {
    /*
     * The branch has to exist at all, and the two halves have to be different
     * sentences — a ternary whose arms had converged would be a branch in name
     * only, and the whole point is that one of these sentences is about a
     * choice the operator does not have on an ICMP-only sweep.
     */
    const description: string = descriptionSection();

    expect(description).toContain("isIcmpOnlyReview");

    const branches: ReviewDescriptionBranches = reviewDescriptionBranches();

    expect(branches.icmpOnly).not.toEqual(branches.snmp);
  });

  test("the ICMP-only branch says what those hosts import as, and what to do next", () => {
    /*
     * The two facts an operator needs before pressing Import on a sweep that
     * asked nothing about SNMP:
     *
     *   - what arrives in the inventory. "pinged by the scan's probe" is the
     *     same phrase the No SNMP pill and the SNMP branch use, so the three
     *     places this concept appears name it identically — and it says the
     *     device has a status on its own, which is the thing the old
     *     "monitor-backed ... polling off" import did not.
     *   - what is still worth adding: SNMP credentials for inventory, and the
     *     optional Ping monitor for incidents.
     */
    const icmpOnly: string = reviewDescriptionBranches().icmpOnly;

    expect(icmpOnly).toContain("ICMP only");
    expect(icmpOnly).toContain("pinged by the scan's probe");
    expect(icmpOnly).toContain("SNMP credentials");
    /*
     * Named the way the dialog's own control names it. Every host an
     * ICMP-only scan finds is a host without SNMP, so the Ping monitor
     * option covers the whole import — pointing at it beats telling the
     * operator to go and create 2,890 monitors by hand.
     */
    expect(icmpOnly).toContain("Create a Ping monitor");
  });

  test("the ICMP-only branch is exactly this sentence", () => {
    /*
     * Verbatim, so a reword is a deliberate act with a failing test attached
     * rather than a silent one. This is the copy an operator reads at the
     * moment they decide whether to import — it IS the feature, not a
     * description of it.
     */
    expect(reviewDescriptionBranches().icmpOnly).toEqual(
      "This scan checked ICMP only, so pick the hosts you want and import — they all arrive as devices pinged by the scan's probe; add SNMP credentials later for inventory. Turn on 'Create a Ping monitor' below if you also want incidents.",
    );
  });

  test("the SNMP branch is exactly this sentence", () => {
    /*
     * The other side of the branch, pinned whole so neither arm can be
     * quietly rewritten in an edit aimed at the other. Reworded once, when
     * ping-first polling replaced the monitor-backed import: "polled devices
     * ... monitor-backed ones" described two kinds of device, and there is
     * one kind now.
     */
    expect(reviewDescriptionBranches().snmp).toEqual(
      "Filter to a group, pick the hosts you want, and import — SNMP hosts arrive with the scan's credentials and are walked for inventory, hosts without SNMP are pinged by the scan's probe until you add some.",
    );
  });

  test("the ICMP-only branch does not describe a filter row that is not on screen", () => {
    /*
     * The row is hidden for this scan (see the next describe), so a sentence
     * telling the operator to "filter to a group" would be pointing at controls
     * that are not there — and "SNMP hosts arrive as polled devices" would be
     * describing an outcome no host on this scan can have.
     */
    const icmpOnly: string = reviewDescriptionBranches().icmpOnly;

    expect(icmpOnly).not.toContain("Filter to a group");
    expect(icmpOnly).not.toContain("walked for inventory");
    expect(icmpOnly).not.toContain("SNMP hosts");
  });

  test("the ICMP-only branch never frames its own results as a shortfall", () => {
    /*
     * "hosts without SNMP" is a caveat: it names what these hosts are NOT, on a
     * scan where that is the entire point of the sweep the operator asked for.
     * And "cannot be imported" is the sentence this description used to end
     * with, which is false for every host on this scan.
     */
    const icmpOnly: string = reviewDescriptionBranches().icmpOnly;

    expect(icmpOnly).not.toContain("without SNMP");
    expect(icmpOnly).not.toContain("cannot be imported");
    expect(icmpOnly).not.toContain("cannot");
  });

  test("the new copy did not reintroduce the banned sentence frame", () => {
    /*
     * `No ${label} hosts in this scan.` is the frame that shipped as "No No
     * SNMP hosts in this scan.", and the tail of it is banned at source. A new
     * branch of copy about hosts and scans is exactly where it would come back.
     */
    expect(readCode()).not.toContain("hosts in this scan.");

    for (const branch of [
      reviewDescriptionBranches().icmpOnly,
      reviewDescriptionBranches().snmp,
    ]) {
      expect(branch).not.toContain("hosts in this scan.");
    }
  });

  test("both branches are punctuated as the sentences they are", () => {
    /*
     * They are concatenated into one paragraph with the scan's label before
     * them and the probe's status message after them, so each has to end as a
     * sentence and start as one. A branch that lost its full stop would run
     * straight into the probe's summary.
     */
    const branches: ReviewDescriptionBranches = reviewDescriptionBranches();

    for (const branch of [branches.icmpOnly, branches.snmp]) {
      expect(branch.trim()).toEqual(branch);
      expect(branch.slice(0, 1)).toEqual(branch.slice(0, 1).toUpperCase());
      expect(branch.endsWith(".")).toBe(true);
    }
  });
});

describe("the SNMP / No SNMP row is not offered on a sweep that sent no SNMP", () => {
  test("the row is gated on the scan's mode, with nothing between the guard and it", () => {
    /*
     * WHY the row is hidden rather than left to render its own zeroes:
     *
     * On an ICMP-only sweep every host is ping-only by construction, so the row
     * reads "All (2,890) · SNMP (0) · No SNMP (2,890)" — two buttons naming the
     * identical set of hosts, and one that can never contain anything. Pressing
     * the empty one shows "No host in this scan answered SNMP.", which is a
     * true sentence that reads as a diagnosis: rejected credentials, wrong
     * version, a firewall on 161. The scan sent no SNMP at all, so there is
     * nothing there to diagnose, and a filter row is the wrong place to learn
     * it.
     *
     * The slice is asserted to be empty because the guard has to wrap THIS row
     * and not merely appear somewhere above it — a guard around a sibling would
     * pass a `toContain` while leaving the row on screen.
     */
    expect(filterButtonsGuardSection().trim()).toEqual(
      "{!isIcmpOnlyReview && (",
    );
  });

  test("the row is still rendered for a scan that did ask about SNMP", () => {
    /*
     * The guard is a negation, so the SNMP case is the fall-through and has no
     * literal of its own to assert. What can be asserted is that the row was
     * hidden by a CONDITION rather than deleted: FilterButtons is still wired
     * to the same options and the same state.
     */
    const section: string = modalSection();

    expect(section).toContain("<FilterButtons");
    expect(section).toContain("options={hostFilterOptions}");
    expect(section).toContain("selectedValue={hostFilter}");
  });
});

describe("the per-row No SNMP pill stays exactly where it was", () => {
  test("the pill is not gated on the scan's mode", () => {
    /*
     * DELIBERATE, and the opposite decision to the filter row above.
     *
     * The pill is a statement about ONE host — this host answered ping and not
     * SNMP — and that is true on an ICMP-only sweep as much as on an SNMP one.
     * Its hover text is the useful part: it says what the host will import as
     * and what to do afterwards, which is precisely the question an operator
     * has about a row on a scan with no SNMP results. Redundancy across a list
     * where every row carries it is a much smaller cost than removing the one
     * place that explains what a credential-less device is.
     */
    expect(pingOnlyBadgeSection()).not.toContain("isIcmpOnlyReview");
  });

  test("the pill still explains what the host imports as and what to add to it", () => {
    /*
     * The same two facts the ICMP-only description carries, in the same words,
     * one row at a time. `title` is the only place they can live on a pill this
     * small.
     */
    const badge: string = pingOnlyBadgeSection();

    expect(badge).toContain("title=");
    expect(badge).toContain("pinged by the scan's probe");
    expect(badge).toContain("SNMP credentials");
    /*
     * What the pill has to convey, not the exact route to it: the device has
     * a status on its own, so the Ping monitor is offered for what it still
     * adds — incidents — rather than as the thing that makes the row go
     * green. The old sentence ("needs a monitor bound to it before it
     * reports a status") is banned because it is no longer true.
     */
    expect(badge).toContain("Create a Ping monitor");
    expect(badge).toContain("incidents");
    expect(badge).not.toContain("needs a monitor bound to it");
    expect(badge).not.toContain("monitor-backed");
    expect(badge).not.toContain("no polling");
  });

  test("the pill's wording and the description's agree about what arrives", () => {
    /*
     * Three pieces of copy, one concept. If any drifts to "unpolled device"
     * or "monitor-backed device", the operator has to work out that the badge
     * on the row and the sentence above the list are describing the same
     * thing.
     */
    expect(pingOnlyBadgeSection()).toContain("pinged by the scan's probe");
    expect(reviewDescriptionBranches().icmpOnly).toContain(
      "pinged by the scan's probe",
    );
    expect(reviewDescriptionBranches().snmp).toContain(
      "pinged by the scan's probe",
    );
  });

  test("nothing in the dialog still describes the monitor-backed import", () => {
    /*
     * The import this dialog used to do — a monitor-backed device with polling
     * off, waiting for a monitor to be bound — is gone, and every sentence
     * that described it went with it. Banned across the whole modal so it
     * cannot survive in a tooltip or a toggle description that the exact
     * assertions above do not reach.
     */
    const section: string = modalSection();

    expect(section).not.toContain("monitor-backed");
    expect(section).not.toContain("polling off");
    expect(section).not.toContain("never polled");
  });
});
