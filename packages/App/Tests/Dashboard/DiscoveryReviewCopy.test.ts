import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostFilter,
  DiscoveredHostFilterOption,
  getDiscoveredHostFilterEmptyMessage,
  getDiscoveredHostFilterLabel,
  getDiscoveredHostFilterOptions,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * Every string the SNMP / No SNMP filter (#3322) puts in front of an operator,
 * and the wiring in the import dialog (DiscoveryImportDialog.tsx and its host
 * list, DiscoveredHostTable.tsx) that puts it there.
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

const DISCOVERY_IMPORT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "NetworkDevice",
  "DiscoveryImport",
);

// The dialog: its description, and the mode it reads the scan in.
const DIALOG_SOURCE: string = path.join(
  DISCOVERY_IMPORT_DIR,
  "DiscoveryImportDialog.tsx",
);

// The host list: the facets, the empty states, the rows and their pills.
const TABLE_SOURCE: string = path.join(
  DISCOVERY_IMPORT_DIR,
  "DiscoveredHostTable.tsx",
);

/*
 * Read once per run, not once per helper call.
 *
 * The helpers below call this forty-odd times, twice inside a single test in
 * places, and the files they read are on a disk other processes edit — a
 * second agent, an editor, a rebase. An uncached read can hand two halves of
 * one test two different files and fail on a difference that never existed in
 * either version, which is a false red nobody can reproduce. The subject of a
 * source-level test has to hold still for the length of the run.
 */
const cachedSources: Map<string, string> = new Map<string, string>();

function readSource(file: string): string {
  if (!cachedSources.has(file)) {
    cachedSources.set(file, fs.readFileSync(file, "utf8"));
  }

  return cachedSources.get(file)!;
}

// Every run of whitespace, block comment and line comment, for the readers below.
const WHITESPACE_RUNS: RegExp = /\s+/g;
const BLOCK_COMMENTS: RegExp = /\/\*[\s\S]*?\*\//g;
// Not after a colon, so "https://" in a string is not taken for a comment.
const LINE_COMMENTS: RegExp = /(^|[^:])\/\/[^\n]*/g;

function squash(source: string): string {
  return source.replace(WHITESPACE_RUNS, " ");
}

function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENTS, " ").replace(LINE_COMMENTS, "$1");
}

/** A file with comments removed and whitespace squashed to single spaces. */
function readCode(file: string): string {
  return squash(stripComments(readSource(file)));
}

/*
 * The Dashboard's English locale (src/Locales/en.json): every key
 * `npm run i18n:extract` found, each mapped to itself. The dialog's copy is
 * looked up in the reader's language (#4280), so a sentence pinned below
 * that is not in here is one no locale can ever translate.
 */
function readEnglishLocale(): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DISCOVERY_IMPORT_DIR, "..", "..", "..", "Locales", "en.json"),
      "utf8",
    ),
  );
}

/*
 * Slicing that refuses to hand back a lie.
 *
 * `String.indexOf` returns -1 for a miss, and `slice(-1, ...)` quietly yields
 * the tail of the file (or an empty string) rather than failing. Both turn a
 * `not.toContain` into a vacuous pass and a `toContain` into a check against
 * the whole file — which is how source-level tests rot into passing for the
 * wrong reason after a rename. Throwing here makes the rename a red test.
 */
function sliceBetween(data: {
  code: string;
  from: string;
  to?: string | undefined;
}): string {
  const start: number = data.code.indexOf(data.from);

  if (start === -1) {
    throw new Error(`The source no longer contains "${data.from}"`);
  }

  if (!data.to) {
    return data.code.slice(start);
  }

  const end: number = data.code.indexOf(data.to, start);

  if (end === -1) {
    throw new Error(
      `The source no longer contains "${data.to}" after "${data.from}"`,
    );
  }

  return data.code.slice(start, end);
}

/** Everything the import dialog renders and says, from its description on. */
function dialogSection(): string {
  return sliceBetween({
    code: readCode(DIALOG_SOURCE),
    from: "const description: string",
  });
}

/** The sentence under the dialog's title: one per kind of scan. */
function descriptionSection(): string {
  return sliceBetween({
    code: readCode(DIALOG_SOURCE),
    from: "const description: string",
    to: "const progressView",
  });
}

/** The host list, from its facets to its last row. */
function tableSection(): string {
  return sliceBetween({
    code: readCode(TABLE_SOURCE),
    from: 'data-testid="discovered-host-table"',
  });
}

/** What the list says when it shows no host. */
function emptyStateSection(): string {
  return sliceBetween({
    code: readCode(TABLE_SOURCE),
    from: 'data-testid="discovered-host-empty"',
    to: '<ul className="divide-y',
  });
}

/** The per-row checkbox, up to its change handler. */
function checkboxSection(): string {
  return sliceBetween({
    code: readCode(TABLE_SOURCE),
    from: "<CheckboxElement dataTestId={`discovered-device-checkbox-",
    to: "onChange={(value: boolean)",
  });
}

/** The "No SNMP" pill on a ping-only row. */
function pingOnlyBadgeSection(): string {
  return sliceBetween({
    code: readCode(TABLE_SOURCE),
    from: "{isPingOnly ? (",
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
 * A reader whose language words two of the groups differently from English,
 * as de.json does. Only the lookup is stubbed; the real translator fills
 * everything in.
 */
function germanTranslator(): Translator {
  const words: Record<string, string> = {
    "No SNMP": "Kein SNMP",
    All: "Alle",
  };

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, "de");
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
     *
     * Both are in the reader's language since #4280, so "worded alike" has
     * to hold there too. The pill looks its words up under the group's own
     * label, and the button names the group through the same lookup — in a
     * locale that words the group ("Kein SNMP"), a button left reading
     * "No SNMP (2,890)" above rows marked "Kein SNMP" is the drift this
     * test exists to stop.
     */
    const badgeText: string = getDiscoveredHostFilterLabel(
      DiscoveredHostFilter.NoSnmp,
    );

    expect(pingOnlyBadgeSection()).toContain(
      `> {translator.translateText(${JSON.stringify(badgeText)})} </span>`,
    );

    const german: Translator = germanTranslator();
    const noSnmpButton: DiscoveredHostFilterOption | undefined =
      getDiscoveredHostFilterOptions(
        scanOf({ snmpCount: 2866, pingOnlyCount: 2890 }),
        german,
      ).find((option: DiscoveredHostFilterOption): boolean => {
        return option.value === DiscoveredHostFilter.NoSnmp;
      });

    expect(noSnmpButton?.label).toEqual(
      `${german.translateText(badgeText)} (2,890)`,
    );
    expect(noSnmpButton?.label).toEqual("Kein SNMP (2,890)");
  });

  test("every button is named in the reader's language, around the same count", () => {
    /*
     * The other groups follow the same rule, and the count is untouched by
     * it: still the group's own size, still with the en-US separators an
     * operator checks against the probe's tally.
     */
    expect(
      getDiscoveredHostFilterOptions(
        scanOf({ snmpCount: 2866, pingOnlyCount: 2890 }),
        germanTranslator(),
      ).map((option: DiscoveredHostFilterOption): string => {
        return option.label;
      }),
    ).toEqual(["Alle (5,756)", "SNMP (2,866)", "Kein SNMP (2,890)"]);
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
  test("the anchors every slice below depends on are still in the files", () => {
    /*
     * A rename that lost one would make the slices throw rather than silently
     * check the whole file. This test is where that is stated out loud, so
     * the failure names the anchor instead of turning up as an unrelated
     * assertion.
     */
    expect(dialogSection().length).toBeGreaterThan(0);
    expect(descriptionSection().length).toBeGreaterThan(0);
    expect(tableSection().length).toBeGreaterThan(0);
    expect(emptyStateSection().length).toBeGreaterThan(0);
    expect(checkboxSection().length).toBeGreaterThan(0);
    expect(pingOnlyBadgeSection().length).toBeGreaterThan(0);
  });

  test("both empty states are rendered through the shared message", () => {
    /*
     * A scan that found nothing at all says so whatever facet is pressed,
     * and a scan with hosts but none in the pressed SNMP / No SNMP group says
     * which - the case the "No No SNMP" defect lived in. Both go through the
     * module so neither can be reworded on its own. When the reader's own
     * search or name facet is what empties the list, the list says that, and
     * offers to clear them.
     */
    const empty: string = emptyStateSection();

    expect(empty).toContain("hosts.length === 0");
    expect(empty).toContain(
      "getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.All)",
    );
    expect(empty).toContain(
      "getDiscoveredHostFilterEmptyMessage(query.answered)",
    );
    expect(empty).toContain(
      'translator.translateText( "No host matches the search and filters.", )',
    );
    expect(empty).toContain('dataTestId="discovered-host-clear-filters"');
  });

  test("the files never build an empty state out of a button label again", () => {
    /*
     * The defect itself, banned at source. Any `No ${getDiscoveredHostFilterLabel(...)}`
     * is the collision returning, and the old frame's tail is banned with it
     * so the sentence cannot be reassembled around a different label call.
     */
    const labelDroppedIntoNoFrame: RegExp =
      /no\s+\$\{\s*getDiscoveredHostFilterLabel/i;

    for (const file of [DIALOG_SOURCE, TABLE_SOURCE]) {
      const code: string = readCode(file);

      expect(labelDroppedIntoNoFrame.test(code)).toBe(false);
      expect(code).not.toContain("hosts in this scan.");
    }
  });

  test("the description explains what each kind of host imports as", () => {
    /*
     * It once ended "hosts without SNMP cannot be imported", which stopped
     * being true when ping-only hosts started importing - and a dialog whose
     * button imports them must never say so. What has to be said is the one
     * difference between the two kinds of host: one that answered SNMP
     * arrives with the credentials that answered it and is walked, the rest
     * are pinged by the scan's probe until credentials are added.
     */
    const description: string = descriptionSection();

    expect(description).not.toContain("cannot be imported");
    expect(description).not.toContain("without SNMP cannot");

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
 * A discovery scan can be run with Check SNMP off: a plain ICMP sweep that
 * sends no SNMP packet, asks for no credentials, and reports every host that
 * answered ping. Three things the dialog says would be wrong on such a scan
 * in a way that reads as a failure rather than as a result:
 *
 *   - a description that offers a choice between two kinds of host the sweep
 *     cannot have;
 *   - an SNMP / No SNMP facet showing two identical groups and one
 *     permanently empty button;
 *   - that empty button's message, "No host in this scan answered SNMP.",
 *     which reads as rejected credentials on a scan that carried none.
 *
 * The first two are handled below. The third is handled by never showing the
 * facet. The per-row pill is deliberately left exactly as it was — see the
 * last describe.
 */

interface ReviewDescriptionBranches {
  icmpOnly: string;
  snmp: string;
}

/*
 * The two halves of the description's ternary: the English sentence each arm
 * looks up in the reader's language. Each is one whole sentence that opens
 * with the scanned range (#4280) - `translator.translateTemplate("Hosts that
 * answered ... in {{range}}. ...", { range: scanLabel })` - so a locale can
 * word and order it its own way. The pattern pins both arms' `range` to the
 * scan's own label, so the sentences asserted below are exactly what the
 * dialog fills in and shows.
 *
 * Same refusal-to-lie contract as sliceBetween: a regex that no longer
 * matches would otherwise hand back empty strings, and every `toContain`
 * below would pass against nothing. If the description stops being a ternary
 * on the scan's mode, this must be the thing that fails, by name.
 */
// Not preceded by `!`, so arms swapped by a negated condition fail here.
const REVIEW_DESCRIPTION_TERNARY: RegExp =
  /(?<![!\w.])isIcmpOnly\s*\?\s*translator\.translateTemplate\(\s*"([^"]+)"\s*,\s*\{\s*range:\s*scanLabel\s*,?\s*\}\s*,?\s*\)\s*:\s*translator\.translateTemplate\(\s*"([^"]+)"\s*,\s*\{\s*range:\s*scanLabel\s*,?\s*\}\s*,?\s*\)/;

function reviewDescriptionBranches(): ReviewDescriptionBranches {
  const match: RegExpMatchArray | null = descriptionSection().match(
    REVIEW_DESCRIPTION_TERNARY,
  );

  if (!match || !match[1] || !match[2]) {
    throw new Error(
      "The import dialog's description is no longer a ternary on isIcmpOnly",
    );
  }

  return { icmpOnly: match[1], snmp: match[2] };
}

/*
 * Everything between the mode guard and the SNMP / No SNMP facet it guards —
 * which, if the guard really does wrap that facet, is only the facet's own
 * wrapper.
 */
function answeredFacetGuardSection(): string {
  return sliceBetween({
    code: readCode(TABLE_SOURCE),
    from: "{!props.isIcmpOnly && (",
    to: 'data-testid="discovered-host-answered-facet"',
  });
}

describe("the import dialog reads differently for a scan that only pinged", () => {
  test("the anchors the ICMP-only slices depend on are still in the files", () => {
    expect(reviewDescriptionBranches().icmpOnly.length).toBeGreaterThan(0);
    expect(reviewDescriptionBranches().snmp.length).toBeGreaterThan(0);
    expect(answeredFacetGuardSection().length).toBeGreaterThan(0);
  });

  test("the mode the dialog branches on is read through ScanModeUtil", () => {
    /*
     * The single line everything else in this file hangs off. Rewriting it
     * to `!scan?.isSnmpEnabled` would flip every scan that has no value for
     * the column — every scan created before #3445 — onto the ICMP-only copy,
     * and take away the SNMP / No SNMP facet it has always had. Absence means
     * SNMP, and the one place that rule is written is ScanModeUtil.
     *
     * The second assertion is the same rule as a ban, so the mode cannot be
     * re-derived off the column anywhere else in the dialog or the list: the
     * only mention allowed is the select's object key.
     */
    expect(readCode(DIALOG_SOURCE)).toContain(
      "const isIcmpOnly: boolean = ScanModeUtil.isIcmpOnly(scan);",
    );

    const modeReadOffTheColumn: RegExp = /[.?]\s*isSnmpEnabled/;

    for (const file of [DIALOG_SOURCE, TABLE_SOURCE]) {
      expect(modeReadOffTheColumn.test(readCode(file))).toBe(false);
    }

    // And the list is told the mode the dialog read, not left to work it out.
    expect(readCode(DIALOG_SOURCE)).toContain("isIcmpOnly={isIcmpOnly}");
  });

  test("the description has a branch for a scan that sent no SNMP", () => {
    const branches: ReviewDescriptionBranches = reviewDescriptionBranches();

    expect(branches.icmpOnly).not.toEqual(branches.snmp);
  });

  test("the ICMP-only branch says what those hosts import as, and what to add later", () => {
    /*
     * The two facts an operator needs before importing a sweep that asked
     * nothing about SNMP: what arrives in the inventory - "pinged by the
     * scan's probe", the same phrase the No SNMP pill and the SNMP branch
     * use - and what is still worth adding: SNMP credentials.
     */
    const icmpOnly: string = reviewDescriptionBranches().icmpOnly;

    expect(icmpOnly).toContain("ICMP only");
    expect(icmpOnly).toContain("pinged by the scan's probe");
    expect(icmpOnly).toContain("SNMP credentials");
  });

  test("the ICMP-only branch is exactly this sentence", () => {
    expect(reviewDescriptionBranches().icmpOnly).toEqual(
      "Hosts that answered ping in {{range}}. This scan checked ICMP only, so every host imports as a device pinged by the scan's probe; add SNMP credentials later to walk them for interfaces and inventory.",
    );
  });

  test("the SNMP branch is exactly this sentence", () => {
    expect(reviewDescriptionBranches().snmp).toEqual(
      "Hosts that answered in {{range}}. A host that answered SNMP imports with the credentials that answered it; the rest are pinged by the scan's probe until you add some.",
    );
  });

  test("both branches open with the scanned range and ask for nothing else", () => {
    /*
     * {{range}} is the only value either asks for — a placeholder nobody
     * fills is shown to the operator as "{{range}}". Both sentences are
     * recorded for translation.
     */
    const placeholder: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
    const english: Record<string, string> = readEnglishLocale();
    const branches: ReviewDescriptionBranches = reviewDescriptionBranches();

    for (const branch of [branches.icmpOnly, branches.snmp]) {
      expect(branch.startsWith("Hosts that answered")).toBe(true);
      expect(branch).toContain(" in {{range}}. ");
      expect(branch.match(placeholder)).toEqual(["{{range}}"]);
      expect(english[branch]).toEqual(branch);
    }
  });

  test("the ICMP-only branch does not describe a choice that is not on screen", () => {
    const icmpOnly: string = reviewDescriptionBranches().icmpOnly;

    expect(icmpOnly).not.toContain("Filter to a group");
    expect(icmpOnly).not.toContain("answered SNMP");
    expect(icmpOnly).not.toContain("SNMP hosts");
  });

  test("the ICMP-only branch never frames its own results as a shortfall", () => {
    const icmpOnly: string = reviewDescriptionBranches().icmpOnly;

    expect(icmpOnly).not.toContain("without SNMP");
    expect(icmpOnly).not.toContain("cannot be imported");
    expect(icmpOnly).not.toContain("cannot");
  });

  test("the new copy did not reintroduce the banned sentence frame", () => {
    for (const branch of [
      reviewDescriptionBranches().icmpOnly,
      reviewDescriptionBranches().snmp,
    ]) {
      expect(branch).not.toContain("hosts in this scan.");
    }
  });

  test("both branches are punctuated as the sentences they are", () => {
    const branches: ReviewDescriptionBranches = reviewDescriptionBranches();

    for (const branch of [branches.icmpOnly, branches.snmp]) {
      expect(branch.trim()).toEqual(branch);
      expect(branch.slice(0, 1)).toEqual(branch.slice(0, 1).toUpperCase());
      expect(branch.endsWith(".")).toBe(true);
    }
  });
});

describe("the SNMP / No SNMP facet is not offered on a sweep that sent no SNMP", () => {
  test("the facet is gated on the scan's mode, with nothing but its own wrapper between", () => {
    /*
     * On an ICMP-only sweep every host is ping-only by construction, so the
     * facet would read "All (2,890) · SNMP (0) · No SNMP (2,890)" — two
     * buttons naming the identical set of hosts, and one that can never
     * contain anything, whose empty message reads as a diagnosis of a
     * credential problem on a scan that carried none.
     *
     * The guard has to wrap THIS facet and not merely appear somewhere above
     * it — a guard around a sibling would pass a `toContain` while leaving
     * the facet on screen.
     */
    expect(answeredFacetGuardSection().trim()).toEqual(
      '{!props.isIcmpOnly && ( <div className="flex items-center gap-2"',
    );
  });

  test("the facet is still rendered for a scan that did ask about SNMP", () => {
    /*
     * The guard is a negation, so the SNMP case is the fall-through. What
     * can be asserted is that the facet was hidden by a CONDITION rather
     * than deleted: FilterButtons is still wired to its options and the
     * query's answered value.
     */
    const facet: string = sliceBetween({
      code: readCode(TABLE_SOURCE),
      from: 'data-testid="discovered-host-answered-facet"',
      to: 'data-testid="discovered-host-name-facet"',
    });

    expect(facet).toContain("<FilterButtons");
    expect(facet).toContain("options={answeredOptions}");
    expect(facet).toContain("selectedValue={query.answered}");
  });
});

describe("the per-row No SNMP pill stays exactly where it was", () => {
  test("the pill is not gated on the scan's mode", () => {
    /*
     * DELIBERATE, and the opposite decision to the facet above. The pill is
     * a statement about ONE host — this host answered ping and not SNMP —
     * and that is true on an ICMP-only sweep as much as on an SNMP one. Its
     * hover text says what the host imports as and what to add afterwards.
     */
    expect(pingOnlyBadgeSection()).not.toContain("isIcmpOnly");
  });

  test("the pill still explains what the host imports as and what to add to it", () => {
    /*
     * The same facts the ICMP-only description carries, in the same words,
     * one row at a time. `title` is the only place they can live on a pill
     * this small. The sentences of the imports it no longer does are banned.
     */
    const badge: string = pingOnlyBadgeSection();

    expect(badge).toContain("title=");
    expect(badge).toContain("pinged by the scan's probe");
    expect(badge).toContain("SNMP credentials");
    expect(badge).not.toContain("needs a monitor bound to it");
    expect(badge).not.toContain("monitor-backed");
    expect(badge).not.toContain("no polling");
  });

  test("the pill's wording and the description's agree about what arrives", () => {
    expect(pingOnlyBadgeSection()).toContain("pinged by the scan's probe");
    expect(reviewDescriptionBranches().icmpOnly).toContain(
      "pinged by the scan's probe",
    );
    expect(reviewDescriptionBranches().snmp).toContain(
      "pinged by the scan's probe",
    );
  });

  test("nothing in the dialog still describes the imports it no longer does", () => {
    /*
     * A monitor-backed device with polling off, waiting for a monitor to be
     * bound - and, since the import moved to the server, the Ping monitor
     * per host it used to offer: an imported device is monitored by a
     * Network Device monitor from a template, chosen in the monitoring step.
     */
    for (const section of [dialogSection(), tableSection()]) {
      expect(section).not.toContain("monitor-backed");
      expect(section).not.toContain("polling off");
      expect(section).not.toContain("never polled");
      expect(section).not.toContain("Create a Ping monitor");
    }
  });
});
