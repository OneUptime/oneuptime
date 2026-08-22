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

function readSource(): string {
  return fs.readFileSync(DISCOVERY_PAGE, "utf8");
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
     */
    const description: string = descriptionSection();

    expect(description).not.toContain("cannot be imported");
    expect(description).not.toContain("without SNMP cannot");
    expect(description).toContain("polled devices");
    expect(description).toContain("monitor-backed");
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
