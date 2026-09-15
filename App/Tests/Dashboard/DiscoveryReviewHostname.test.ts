import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostNaming,
  MAX_DEVICE_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
  getDiscoveredHostDisplayName,
  getDiscoveredHostFullName,
} from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "Common/Utils/NetworkDiscovery/DiscoveredHostUtil";
import { normalizeReverseDnsName } from "Common/Utils/NetworkDiscovery/ReverseDnsNameUtil";
import ObjectID from "Common/Types/ObjectID";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * OneUptime issue #3529 — "Network Discovery Scan should perform reverse DNS
 * lookup and display hostnames". The report is a screenshot of the Review
 * Discovered Devices dialog listing
 *
 *     10.18.166.51
 *     10.18.166.53
 *     10.18.166.54
 *     10.18.166.55
 *
 * on an estate where every one of those addresses has a DNS record. The rows
 * are hosts with no readable SNMP, and the dialog's name line was
 * `entry.sysName || entry.ipAddress` — with no sysName there was nothing left
 * to fall back to.
 *
 * The fix has a probe half (resolve the PTR record) and a dashboard half
 * (show it), and the dashboard half is the one that closes the loop the
 * reporter actually saw. This file pins that half.
 *
 * HOW IT TESTS A REACT ROW WITH NO REACT RENDERER
 *
 * The App suite runs in a plain Node environment, so the dialog cannot be
 * mounted and read. Restating the row's rule in a local helper and testing
 * THAT would be circular — it would pass with the row deleted. So instead the
 * row's own name/second-line expressions are LIFTED OUT OF Discovery.tsx by
 * `rowNameSource()` and COMPILED, then run against the real shared builders.
 * Every test below that says "the row" is running the page's own code:
 *
 *   - delete the second line's computation  -> the extraction throws;
 *   - invert its `!== displayName` gate     -> the executed result inverts;
 *   - render `entry.dnsHostname` raw        -> the hostile-PTR and root-dot
 *                                              cases below start failing;
 *   - rename `displayName` to `ptrName`     -> nothing breaks, because the
 *                                              identifiers are read out of the
 *                                              source rather than hard-coded.
 *
 * The remaining source-level assertions (final describe) cover what execution
 * cannot see: that the computed values are actually RENDERED, and that the old
 * inline rule is gone. Duplicated rules drift, and this rule drifting means the
 * operator ticks a box next to one name and gets a device with another.
 *
 * SHORT NAMES (issue #3678)
 *
 * A scan can now ask for its hosts to be named by the first label of their
 * hostname. Every naming function takes the scan's naming choice as a
 * REQUIRED argument, so the row, the import, the collision retry and the Ping
 * monitor name each have to be handed one — and this file checks that the
 * row is handed the SAME scan the import builds from, that the row shows the
 * short name the device will be created with, and that the full name the
 * short one was cut from is still readable on the row's second line.
 */

/*
 * The two naming choices a scan can make. FULL_NAMES is what every scan that
 * predates #3678 carries (the column defaults to false); an empty object is
 * the same answer, because only an exact `true` turns short names on.
 */
const FULL_NAMES: DiscoveredHostNaming = { useShortDeviceNames: false };
const SHORT_NAMES: DiscoveredHostNaming = { useShortDeviceNames: true };

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
 * Read once per run. The page is a file on disk that other processes edit —
 * another agent, an editor, a rebase — and an uncached read can hand two
 * halves of one test two different files, failing on a difference that never
 * existed in either.
 */
let cachedSource: string | null = null;

function readSource(): string {
  if (cachedSource === null) {
    cachedSource = fs.readFileSync(DISCOVERY_PAGE, "utf8");
  }

  return cachedSource;
}

/*
 * Comments stripped so that DESCRIBING a rule in prose never counts as
 * implementing it. Split out of readCode() so the stripper itself can be
 * tested on a synthetic input: it is the foundation every source assertion in
 * this file rests on, and a stripper that silently stopped stripping would
 * take the whole final describe green against the page's prose alone.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/*
 * Comments gone and whitespace squashed, so Prettier can reflow props without
 * making the assertions brittle. NOTE for anyone adding an assertion: after
 * this squash a source `a || b` always reads back WITH single spaces, so a
 * `not.toContain("a||b")` can never fail. Use a regex with `\s*`.
 */
function readCode(): string {
  return stripComments(readSource()).replace(/\s+/g, " ");
}

/*
 * THE ROW'S OWN NAMING CODE, READ OUT OF THE PAGE.
 *
 * The block between `const <name> = buildDeviceName(entry, <scan>)` and the
 * row's `return (` is the entirety of what the row computes about names: the
 * clamped (and, when the scan asks, shortened) display name, the full name it
 * was cut from, the re-normalised PTR name, and the gates that decide which of
 * those earn a place beside the address. It is self-contained — it touches
 * nothing but `entry`, the scan it is handed, and the imported builders —
 * which is what makes lifting and running it possible.
 *
 * The identifiers are CAPTURED rather than assumed, so a pure rename of
 * `displayName`, `scanToReview` or either second-line value leaves every test
 * here passing while a change of BEHAVIOUR still fails them. That matters: an
 * earlier version of this file hard-coded the names, so a rename broke six
 * tests that had no opinion about naming at all.
 */
interface RowNameSource {
  /* The identifier holding `buildDeviceName(entry, …)` — the visible name line. */
  displayNameIdentifier: string;
  /*
   * The identifier the row hands the builder as its naming argument: the scan
   * under review. Captured so it can be injected when the block is run, and
   * so the import's own naming arguments can be required to be the same one.
   */
  namingIdentifier: string;
  /*
   * The identifiers the row prints beside the address, in render order — one
   * gated ` · <name>` span each. Read off the RENDERED line rather than off
   * the order of declarations, so what the tests execute is exactly what the
   * row paints, and a value computed but never rendered is not mistaken for
   * part of the second line.
   */
  secondaryIdentifiers: Array<string>;
  /* The statements themselves, comments stripped and whitespace squashed. */
  statements: string;
}

const ROW_NAME_BLOCK: RegExp =
  /(const\s+(\w+)\s*(?::[^=]*)?=\s*buildDeviceName\(\s*entry\s*,\s*(\w+)\s*,?\s*\);.*?)return \(/;

/*
 * The row's second line: the truncating div that opens with the address, up
 * to its own closing tag. Everything the row says beside the address is in
 * here, and nothing in here is a nested div.
 */
const ADDRESS_LINE: RegExp =
  /<div\s+className="truncate[^"]*"\s*>\s*\{entry\.ipAddress\}(.*?)<\/div>/;

/*
 * One extra name on that line: rendered only when its identifier holds
 * something, and separated from what precedes it by a middle dot.
 */
const SECONDARY_NAME_SPAN: RegExp =
  /\{(\w+)\s*&&\s*\(\s*<span\s+className="[^"]*"\s*>\s*\{" · "\}\s*\{\1\}\s*<\/span>\s*\)\s*\}/g;

let cachedRowNameSource: RowNameSource | null = null;

function addressLineContent(): string {
  const match: RegExpMatchArray | null = readCode().match(ADDRESS_LINE);

  if (!match) {
    throw new Error(
      "The discovered-host row no longer renders `{entry.ipAddress}` at the" +
        " start of a truncating div. The address line is where every name" +
        " the name line does not show is surfaced.",
    );
  }

  return match[1]!;
}

function rowNameSource(): RowNameSource {
  if (cachedRowNameSource !== null) {
    return cachedRowNameSource;
  }

  const match: RegExpMatchArray | null = readCode().match(ROW_NAME_BLOCK);

  if (!match) {
    throw new Error(
      "Discovery.tsx no longer computes `buildDeviceName(entry, <scan>)` into" +
        " a const before the discovered-host row's `return (`. The Review" +
        " dialog's name line is what issues #3529 and #3678 changed; if it" +
        " moved, move these tests with it rather than deleting them.",
    );
  }

  const statements: string = match[1]!;

  const secondaryIdentifiers: Array<string> = Array.from(
    addressLineContent().matchAll(SECONDARY_NAME_SPAN),
    (span: RegExpMatchArray) => {
      return span[1]!;
    },
  );

  /*
   * Two, because the row has two things to say beside the address: the full
   * name the name line was cut from, and a PTR record that is neither. Fewer
   * means one of them was dropped, which the behaviour tests below would
   * also catch — but this says which, and why.
   */
  if (secondaryIdentifiers.length < 2) {
    throw new Error(
      `The discovered-host row renders ${secondaryIdentifiers.length} gated` +
        " name(s) beside the address; it needs the full name and the PTR name.",
    );
  }

  /*
   * Every rendered value has to be COMPUTED in the lifted block. Deleting a
   * computation would otherwise surface here as a bare ReferenceError from
   * inside `new Function`, which says nothing about what went missing.
   */
  for (const identifier of secondaryIdentifiers) {
    if (!new RegExp(`const\\s+${identifier}\\s*[:=]`).test(statements)) {
      throw new Error(
        `The row renders \`${identifier}\` beside the address but does not` +
          " compute it between the name line and `return (`.",
      );
    }
  }

  cachedRowNameSource = {
    displayNameIdentifier: match[2]!,
    namingIdentifier: match[3]!,
    secondaryIdentifiers: secondaryIdentifiers,
    statements: statements,
  };

  return cachedRowNameSource;
}

/*
 * `const x: string | undefined = ...` -> `const x = ...`, so the lifted block
 * is executable JavaScript. Only the annotation between the declared name and
 * the first `=` is removed; nothing else in the block is touched.
 */
function stripTypeAnnotations(statements: string): string {
  return statements.replace(/const\s+(\w+)\s*:\s*[^=]*=/g, "const $1 =");
}

/* What the row shows for one host, as the row itself computes it. */
interface RowNames {
  /* The name line (and the name the import attempts first). */
  displayName: string;
  /*
   * The names printed after the address, in order, exactly as many as the row
   * renders: a gated span whose value is empty prints nothing, so it is not
   * listed here either.
   */
  extraNames: Array<string>;
}

type RowNamesFunction = (
  entry: DiscoveredNetworkDevice,
  buildName: typeof buildDeviceName,
  getFullName: typeof getDiscoveredHostFullName,
  normalizeName: typeof normalizeReverseDnsName,
  naming: DiscoveredHostNaming,
) => [string, Array<string | undefined>];

let cachedRowNames: RowNamesFunction | null = null;

/**
 * What the row shows for this host under this scan's naming choice — computed
 * by running the row's own statements, with the real shared builders injected.
 *
 * The parameter names are the page's own call names, so an alias-rename in
 * Discovery.tsx fails the extraction loudly instead of quietly.
 */
function rowNamesFor(
  host: DiscoveredNetworkDevice,
  naming: DiscoveredHostNaming,
): RowNames {
  if (cachedRowNames === null) {
    const source: RowNameSource = rowNameSource();

    cachedRowNames = new Function(
      "entry",
      "buildDeviceName",
      "getDiscoveredHostFullName",
      "normalizeReverseDnsName",
      source.namingIdentifier,
      `${stripTypeAnnotations(source.statements)} return [${
        source.displayNameIdentifier
      }, [${source.secondaryIdentifiers.join(", ")}]];`,
    ) as unknown as RowNamesFunction;
  }

  const [displayName, secondaryValues]: [string, Array<string | undefined>] =
    cachedRowNames(
      host,
      buildDeviceName,
      getDiscoveredHostFullName,
      normalizeReverseDnsName,
      naming,
    );

  return {
    displayName: displayName,
    // `{value && (...)}` renders nothing for an empty or absent value.
    extraNames: secondaryValues.filter(
      (value: string | undefined): value is string => {
        return Boolean(value);
      },
    ),
  };
}

/**
 * The names the row prints beside the address for this host. Kept as its own
 * helper because most tests below have an opinion only about the second line.
 */
function extraNamesFor(
  host: DiscoveredNetworkDevice,
  naming: DiscoveredHostNaming,
): Array<string> {
  return rowNamesFor(host, naming).extraNames;
}

/*
 * The checkbox's accessible name, lifted and run the same way. A screen-reader
 * user never sees the row; this template is the entire row, for them.
 */
const ARIA_LABEL_TEMPLATE: RegExp = /ariaLabel=\{(`Import [^`]*`)\}/;

type RowAriaLabel = (
  entry: DiscoveredNetworkDevice,
  displayName: string,
) => string;

let cachedAriaLabel: RowAriaLabel | null = null;

function ariaLabelTemplate(): string {
  const match: RegExpMatchArray | null = readCode().match(ARIA_LABEL_TEMPLATE);

  if (!match) {
    throw new Error(
      "The discovered-host checkbox no longer carries an `ariaLabel={`Import" +
        " ...`}`. A disabled checkbox in a list that does not say what it is" +
        " reads as broken rather than as deliberate.",
    );
  }

  return match[1]!;
}

/*
 * Fed the name line the ROW computes for this scan, not a name recomputed
 * here: the claim is that the label says what the row says, under whichever
 * naming choice the scan made.
 */
function ariaLabelFor(
  host: DiscoveredNetworkDevice,
  naming: DiscoveredHostNaming,
): string {
  if (cachedAriaLabel === null) {
    cachedAriaLabel = new Function(
      "entry",
      rowNameSource().displayNameIdentifier,
      `return ${ariaLabelTemplate()};`,
    ) as unknown as RowAriaLabel;
  }

  return cachedAriaLabel(host, rowNamesFor(host, naming).displayName);
}

/*
 * A fully qualified name at the DNS presentation-form ceiling: four labels of
 * 63/63/63/61 characters plus three dots is exactly 253, which
 * normalizeReverseDnsName accepts and NetworkDevice.name cannot hold. Built
 * from repeats rather than written out so the arithmetic is checkable, and
 * asserted below rather than assumed.
 */
const LONG_PTR_NAME: string = [
  "a".repeat(63),
  "b".repeat(63),
  "c".repeat(63),
  "d".repeat(61),
].join(".");

/*
 * A DIFFERENT maximal name that agrees with LONG_PTR_NAME for its first 192
 * characters — so the two are identical after the 80-character clamp. Two
 * hosts under one reverse zone with long, structured names (the shape
 * `<role>.<rack>.<row>.<site>` produces routinely) collide this way, and the
 * collision exists ONLY because of the clamp this feature added.
 */
const TWIN_PTR_NAME: string = [
  "a".repeat(63),
  "b".repeat(63),
  "c".repeat(63),
  "e".repeat(61),
].join(".");

/*
 * The reporter's four rows, as the probe now reports them: alive, no SNMP,
 * and each with the PTR record their estate publishes.
 */
function reportedHosts(): Array<DiscoveredNetworkDevice> {
  return [
    {
      ipAddress: "10.18.166.51",
      snmpReachable: false,
      dnsHostname: "core-gw.corp.example.com",
    },
    {
      ipAddress: "10.18.166.53",
      snmpReachable: false,
      dnsHostname: "printer-3.corp.example.com",
    },
    {
      ipAddress: "10.18.166.54",
      snmpReachable: false,
      dnsHostname: "cam-lobby.corp.example.com",
    },
    // No PTR record: this one keeps its address, which is the stated fallback.
    { ipAddress: "10.18.166.55", snmpReachable: false },
  ];
}

/*
 * What the dialog's name line renders, computed the way the row computes it:
 * normalise the jsonb, then ask for the name the device would be CREATED
 * with. Both steps matter — the row is fed by getReviewHosts, which
 * normalises first, and it renders buildDeviceName rather than the unclamped
 * display name so that what is shown and what is created cannot differ.
 *
 * Run through the row's OWN statements (rowNamesFor), under the scan's naming
 * choice. Every scan that predates issue #3678 names by full name, which is
 * what the default here stands for.
 */
function displayedNames(
  hosts: Array<DiscoveredNetworkDevice>,
  naming: DiscoveredHostNaming = FULL_NAMES,
): Array<string> {
  return normalizeDiscoveredHosts(hosts).map(
    (host: DiscoveredNetworkDevice) => {
      return rowNamesFor(host, naming).displayName;
    },
  );
}

describe("the Review dialog names hosts by their PTR record (issue #3529)", () => {
  test("the reported rows read as hostnames instead of addresses", () => {
    expect(displayedNames(reportedHosts())).toEqual([
      "core-gw.corp.example.com",
      "printer-3.corp.example.com",
      "cam-lobby.corp.example.com",
      // The stated fallback: no reverse record, so the address stands.
      "10.18.166.55",
    ]);
  });

  test("the name never carries the address, so the address line is load-bearing", () => {
    /*
     * The name replaces the LABEL, never the address. Asserting that the
     * normaliser hands its own input back would prove nothing; what has to
     * hold is that the row's two lines now say DIFFERENT things, so deleting
     * the address line loses information rather than removing a duplicate.
     * An operator matching a row against a firewall rule or a patch panel has
     * only that line to match on.
     */
    const named: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts(
      reportedHosts(),
    ).filter((host: DiscoveredNetworkDevice) => {
      return Boolean(host.dnsHostname);
    });

    expect(named).toHaveLength(3);

    for (const host of named) {
      expect(buildDeviceName(host, FULL_NAMES)).not.toContain(host.ipAddress);
    }
  });

  test("the device that imports is still addressed by its address", () => {
    /*
     * The other half of the same guarantee, and the one the rest of the system
     * depends on: `hostname` is the dedup key the ingest path matches scan
     * results against and the address the SNMP poller dials. Storing the PTR
     * name here would make a device stop polling the day its reverse zone
     * changed, and would import the same host twice — once by address, once by
     * name.
     */
    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      {
        ipAddress: "10.18.166.51",
        snmpReachable: false,
        dnsHostname: "core-gw.corp.example.com",
      },
    ])[0]!;

    const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: new ObjectID("00000000-0000-0000-0000-000000000001"),
      host: host,
      scan: {},
    });

    expect(device.name).toBe("core-gw.corp.example.com");
    expect(device.hostname).toBe("10.18.166.51");
  });

  test("an SNMP host keeps its sysName as the name line", () => {
    // Unchanged behaviour for every scan that already worked.
    expect(
      displayedNames([
        {
          ipAddress: "10.0.0.5",
          sysName: "core-switch-01",
          dnsHostname: "sw1.corp.example.com",
          snmpReachable: true,
        },
      ]),
    ).toEqual(["core-switch-01"]);
  });

  test("a scan stored before reverse DNS existed renders exactly as it did", () => {
    /*
     * Every scan result already in the database, and every result from a
     * probe that has not been upgraded, has no dnsHostname at all.
     */
    expect(
      displayedNames([
        { ipAddress: "10.0.0.5", sysName: "core-switch-01" },
        { ipAddress: "10.0.0.6" },
      ]),
    ).toEqual(["core-switch-01", "10.0.0.6"]);
  });

  test("a non-string sysName names the host by DNS instead of taking out the dialog", () => {
    /*
     * `sysName` is jsonb: its declared TypeScript type describes what the
     * probe SHOULD send, not what is stored. Two separate guards exist for
     * this and BOTH source comments name the same failure — a TypeError inside
     * this dialog's render, which takes out the whole modal rather than one
     * row — so both are exercised here.
     *
     * First guard, in getDiscoveredHostDisplayName: `(42).trim()` throws, so
     * the typeof check is what stands between a numeric sysName and a blank
     * Review dialog. Called on the RAW host, because a future caller feeding
     * the modal without normalizeDiscoveredHosts is exactly the case it is for.
     */
    const numericSysName: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      sysName: 42,
      dnsHostname: "core-gw.corp.example.com",
    } as unknown as DiscoveredNetworkDevice;

    expect(getDiscoveredHostDisplayName(numericSysName, FULL_NAMES)).toBe(
      "core-gw.corp.example.com",
    );

    /*
     * Second guard, in normalizeDiscoveredHosts, and it is the sharper one: a
     * non-string sysName is BLANKED, never stringified. `String(null)` is
     * "null" and `String({})` is "[object Object]" — both truthy, both
     * strings, so both would survive the typeof guard above and WIN the naming
     * contest outright, creating a device called "null" beside a perfectly
     * good PTR record on the same row. That is a direct #3529 regression, and
     * these are the assertions that catch it: swap the blanking for String()
     * and the expected names below become "null" and "[object Object]".
     */
    const brokenSysNames: Array<DiscoveredNetworkDevice> = [
      numericSysName,
      {
        ipAddress: "10.0.0.6",
        sysName: null,
        dnsHostname: "printer-3.corp.example.com",
      },
      {
        ipAddress: "10.0.0.7",
        sysName: {},
        dnsHostname: "cam-lobby.corp.example.com",
      },
    ] as unknown as Array<DiscoveredNetworkDevice>;

    expect(displayedNames(brokenSysNames)).toEqual([
      "core-gw.corp.example.com",
      "printer-3.corp.example.com",
      "cam-lobby.corp.example.com",
    ]);
  });

  test("a blank-padded sysName is not a name, so the PTR record still wins", () => {
    /*
     * `"   "` is truthy, and nothing trims sysName on the way out of the jsonb
     * — normalizeDiscoveredHosts only rewrites it when it is not a string. So
     * the `.trim()` inside getDiscoveredHostDisplayName's typeof guard is the
     * ONLY thing that makes a whitespace-only sysName fall through. Delete
     * that one `.trim()` and every host whose SNMP agent reports a padded or
     * empty sysName — common on gear that was never given a hostname — is
     * shown, and imported, as a device named " ", with a perfectly good PTR
     * record sitting unused on the same row.
     */
    const paddedSysName: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      sysName: "   ",
      dnsHostname: "core-gw.corp.example.com",
      snmpReachable: true,
    };

    expect(getDiscoveredHostDisplayName(paddedSysName, FULL_NAMES)).toBe(
      "core-gw.corp.example.com",
    );
    expect(displayedNames([paddedSysName])).toEqual([
      "core-gw.corp.example.com",
    ]);

    // And with no PTR record either, it falls all the way to the address.
    expect(
      displayedNames([{ ipAddress: "10.0.0.6", sysName: "\t\n " }]),
    ).toEqual(["10.0.0.6"]);
  });

  test("a hostile PTR record renders as the address, not as itself", () => {
    /*
     * React escapes on render, so this is not about script execution — it is
     * about a scan of a subnet this project does not administer being able to
     * choose what an operator reads on a row they are about to tick.
     */
    expect(
      displayedNames([
        { ipAddress: "10.0.0.5", dnsHostname: "<script>alert(1)</script>" },
        { ipAddress: "10.0.0.6", dnsHostname: "Already added" },
        { ipAddress: "10.0.0.7", dnsHostname: "10.0.0.7" },
      ]),
    ).toEqual(["10.0.0.5", "10.0.0.6", "10.0.0.7"]);
    /*
     * The middle one is worth stating plainly: "Already added" is a single
     * label of letters and a space, and the space is what disqualifies it. A
     * PTR record that could render as one of the dialog's own badges would let
     * the scanned network lie to the operator about the dialog's state, and
     * the character rules are what make that unreachable.
     */
  });

  test("a rejected PTR record is removed from the host, not blanked", () => {
    /*
     * The naming assertions above cannot see this: the name is the address
     * either way. But normalizeDiscoveredHosts states the contract in as many
     * words — a reader that asks `if (host.dnsHostname)` and a reader that
     * asks `"dnsHostname" in host` must not disagree — and `delete` rather
     * than `= ""` is what makes that true. A blanked key is a host that
     * ADVERTISES a reverse name and then has none, which is how a "resolved"
     * count, a filter facet or a rule predicate keyed on presence ends up
     * counting hosts whose PTR answer was thrown away for being hostile.
     */
    const rejected: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      { ipAddress: "10.0.0.5", dnsHostname: "<script>alert(1)</script>" },
    ])[0]!;

    expect("dnsHostname" in rejected).toBe(false);

    // A host that never had the key does not gain one either.
    expect(
      "dnsHostname" in
        normalizeDiscoveredHosts([{ ipAddress: "10.0.0.6" }])[0]!,
    ).toBe(false);

    // And an accepted one is still there, so the assertion above is not free.
    expect(
      "dnsHostname" in
        normalizeDiscoveredHosts([
          { ipAddress: "10.0.0.7", dnsHostname: "core-gw.corp.example.com" },
        ])[0]!,
    ).toBe(true);
  });

  test("a 253-character PTR name is shown clamped, exactly as it is created", () => {
    /*
     * The WYSIWYG defect the row's switch to buildDeviceName fixed. The name
     * line used to render the UNCLAMPED display name, so a host with a
     * maximal FQDN showed 253 characters and imported as a different,
     * 80-character device — the operator ticked a box next to one name and
     * got another. It could only ever show up on the longest, least
     * memorable names, which is exactly where nobody would notice.
     */
    expect(LONG_PTR_NAME).toHaveLength(253);

    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      { ipAddress: "10.18.166.51", dnsHostname: LONG_PTR_NAME },
    ])[0]!;

    // The clamp has to actually bite, or this test proves nothing.
    expect(getDiscoveredHostDisplayName(host, FULL_NAMES)).toHaveLength(253);

    const shownName: string = buildDeviceName(host, FULL_NAMES);

    expect(shownName).toHaveLength(MAX_DEVICE_NAME_LENGTH);
    expect(shownName).toBe(LONG_PTR_NAME.substring(0, MAX_DEVICE_NAME_LENGTH));
    expect(displayedNames([{ ...host }])).toEqual([shownName]);
  });
});

describe("the row's second line surfaces a PTR name the first line does not", () => {
  /*
   * Every test here runs Discovery.tsx's own second-line expression — see
   * `rowNameSource` above. Inverting the row's gate, dropping the
   * normalisation, or deleting the computation each fails at least one of
   * them, which is the whole reason the block is lifted rather than restated.
   */

  test("an SNMP host's disagreeing PTR record is still surfaced", () => {
    /*
     * sysName wins the name line, so before the second line existed the PTR
     * record was resolved, stored and then never shown. Two teams naming one
     * box, or a stale reverse zone, is something the operator wants in front
     * of them while deciding to import — not something the dialog swallows.
     */
    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      {
        ipAddress: "10.0.0.5",
        sysName: "core-switch-01",
        dnsHostname: "sw1.corp.example.com",
        snmpReachable: true,
      },
    ])[0]!;

    expect(buildDeviceName(host, FULL_NAMES)).toBe("core-switch-01");
    expect(extraNamesFor(host, FULL_NAMES)).toEqual(["sw1.corp.example.com"]);
  });

  test("a PTR name that IS the name line is not printed twice", () => {
    /*
     * The reporter's own rows: no SNMP, so the PTR name is the name line.
     * Repeating it beside the address would make every row in the dialog the
     * feature was built for read as "name / address · name". This is the test
     * that fails if the row's `!== displayName` gate is removed or inverted.
     */
    for (const host of normalizeDiscoveredHosts(reportedHosts())) {
      expect(extraNamesFor(host, FULL_NAMES)).toEqual([]);
    }
  });

  test("a PTR answer carrying the root dot is not printed a second time", () => {
    /*
     * "core-gw.corp.example.com." is the form a resolver most often hands
     * back, and it is what separates the row's gate from a naive one. The row
     * compares the NORMALISED name against the name line; comparing
     * `entry.dnsHostname` directly would find "core-gw.corp.example.com." !==
     * "core-gw.corp.example.com" and print a spurious duplicate line on every
     * one of the reporter's own rows.
     *
     * Fed RAW, not through normalizeDiscoveredHosts, because normalising first
     * would strip the dot and destroy the case being tested — and because a
     * caller that feeds the modal unnormalised is precisely the situation the
     * row's re-normalisation exists for.
     */
    const raw: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.51",
      dnsHostname: "core-gw.corp.example.com.",
    };

    expect(buildDeviceName(raw, FULL_NAMES)).toBe("core-gw.corp.example.com");
    expect(extraNamesFor(raw, FULL_NAMES)).toEqual([]);
  });

  test("a PTR name too long to be a device name stays readable in full", () => {
    /*
     * The clamp is what makes the second line necessary rather than merely
     * nice: the name line now stops at 80 characters, so without this the
     * remaining 173 characters of the FQDN — the part that says which host it
     * is — would exist nowhere on the row. The row shows all 253.
     */
    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      { ipAddress: "10.18.166.51", dnsHostname: LONG_PTR_NAME },
    ])[0]!;

    expect(buildDeviceName(host, FULL_NAMES)).toHaveLength(
      MAX_DEVICE_NAME_LENGTH,
    );
    expect(extraNamesFor(host, FULL_NAMES)).toEqual([LONG_PTR_NAME]);
  });

  test("a host with no usable PTR record has no second line", () => {
    // Nothing to say, so nothing is said: no empty separator on the address.
    expect(
      extraNamesFor(
        { ipAddress: "10.18.166.55", snmpReachable: false },
        FULL_NAMES,
      ),
    ).toEqual([]);

    /*
     * Fed raw on purpose. A resolver that echoes the query name back hands us
     * "51.166.18.10.in-addr.arpa", which is a legal hostname string and a
     * strictly worse label than the address it came from. The row's own
     * re-normalisation is the thing being tested: render `entry.dnsHostname`
     * instead and this row grows a second line reading the reverse zone.
     */
    expect(
      extraNamesFor(
        {
          ipAddress: "10.18.166.55",
          dnsHostname: "51.166.18.10.in-addr.arpa",
        },
        FULL_NAMES,
      ),
    ).toEqual([]);

    // Same for an answer the character rules reject outright.
    expect(
      extraNamesFor(
        {
          ipAddress: "10.18.166.55",
          dnsHostname: "<script>alert(1)</script>",
        },
        FULL_NAMES,
      ),
    ).toEqual([]);
  });
});

describe("the checkbox tells a screen reader what the row says", () => {
  test("the label carries the name line and the address", () => {
    /*
     * Runs the page's own aria-label template. A sighted operator reads the
     * name line and the address line; a screen-reader user gets this string
     * and nothing else, so it has to carry both — the name to know WHICH host
     * is being ticked, the address because the name is no longer unique per
     * host (a wildcard PTR zone gives a whole DHCP range one name, and without
     * the address every checkbox in that range announces identically).
     */
    expect(
      ariaLabelFor(
        {
          ipAddress: "10.18.166.51",
          dnsHostname: "core-gw.corp.example.com",
          snmpReachable: false,
        },
        FULL_NAMES,
      ),
    ).toBe("Import core-gw.corp.example.com (10.18.166.51)");
  });

  test("a host that reported no address still announces as something", () => {
    /*
     * The branch the previous version of this file never touched. A host with
     * a blank address cannot be imported at all — the checkbox is disabled and
     * carries a hoverText saying why — but it is still IN the list, and
     * without the `|| "no address"` fallback its label reads
     * "Import core-switch-01 ()", which sounds like a rendering bug rather
     * than like a host the dialog is deliberately refusing.
     */
    expect(
      ariaLabelFor({ ipAddress: "", sysName: "core-switch-01" }, FULL_NAMES),
    ).toBe("Import core-switch-01 (no address)");

    // Nothing to say at all is still a sentence, not an empty one.
    expect(ariaLabelFor({ ipAddress: "" }, FULL_NAMES)).toBe(
      "Import  (no address)",
    );
  });
});

describe("hosts that share one PTR name still all import", () => {
  test("the fallback name distinguishes hosts a wildcard PTR zone named alike", () => {
    /*
     * `*.166.18.10.in-addr.arpa IN PTR dhcp-pool.corp.example.com` is how a
     * DHCP range is routinely published, and it gives every host in the range
     * one name. Device names are unique per project, so before the import
     * retry the first host was created and the rest failed with "Network
     * Device with the same name already exists" — the feature turning into a
     * regression for exactly the estates it was built for. Ping-only hosts
     * used to be named by their addresses, so this could not happen at all
     * until issue #3529 landed.
     */
    const shared: string = "dhcp-pool.corp.example.com";
    const hosts: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
      { ipAddress: "10.18.166.51", dnsHostname: shared },
      { ipAddress: "10.18.166.52", dnsHostname: shared },
    ]);

    // The collision is real: the first-choice names genuinely are identical.
    expect(
      hosts.map((host: DiscoveredNetworkDevice) => {
        return buildDeviceName(host, FULL_NAMES);
      }),
    ).toEqual([shared, shared]);

    const fallbackNames: Array<string> = hosts.map(
      (host: DiscoveredNetworkDevice) => {
        return buildFallbackDeviceName(host, FULL_NAMES);
      },
    );

    expect(new Set<string>(fallbackNames).size).toBe(2);
    expect(fallbackNames).toEqual([
      "dhcp-pool.corp.example.com (10.18.166.51)",
      "dhcp-pool.corp.example.com (10.18.166.52)",
    ]);
  });

  test("two maximal PTR names that agree for 80 characters still import as two devices", () => {
    /*
     * A collision mode created by the clamp itself, and therefore by this very
     * change: two DIFFERENT 253-character names whose first 80 characters
     * match are one name after buildDeviceName. The address-qualified fallback
     * was designed around wildcard zones (identical names), not around this —
     * and it survives only because it truncates the BASE to 65 before
     * appending, so the address is never itself clamped off.
     *
     * That is the part with no other guard: widen the suffix budget, or clamp
     * the composed string instead of the base, and both hosts get the same
     * fallback name too — at which point the second host is uncreatable and
     * the import reports a name collision the operator cannot act on.
     */
    expect(LONG_PTR_NAME).not.toBe(TWIN_PTR_NAME);
    expect(LONG_PTR_NAME.substring(0, MAX_DEVICE_NAME_LENGTH)).toBe(
      TWIN_PTR_NAME.substring(0, MAX_DEVICE_NAME_LENGTH),
    );

    const hosts: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
      { ipAddress: "10.18.166.51", dnsHostname: LONG_PTR_NAME },
      { ipAddress: "10.18.166.52", dnsHostname: TWIN_PTR_NAME },
    ]);

    const shownNames: Array<string> = hosts.map(
      (host: DiscoveredNetworkDevice) => {
        return buildDeviceName(host, FULL_NAMES);
      },
    );

    // Both rows read identically, which is what makes the retry necessary.
    expect(new Set<string>(shownNames).size).toBe(1);

    const fallbackNames: Array<string> = hosts.map(
      (host: DiscoveredNetworkDevice) => {
        return buildFallbackDeviceName(host, FULL_NAMES);
      },
    );

    expect(new Set<string>(fallbackNames).size).toBe(2);

    for (const fallbackName of fallbackNames) {
      expect(fallbackName.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
    }
  });

  test("the fallback name still fits when the PTR name is maximal", () => {
    /*
     * The retry is worthless if its own name overflows: NetworkDevice.name is
     * varchar(100) and the slug derived from it has its own ceiling, so a
     * fallback that simply appended to a 253-character name would fail the
     * create for a second, more confusing reason.
     */
    const name: string = buildFallbackDeviceName(
      {
        ipAddress: "10.18.166.51",
        dnsHostname: LONG_PTR_NAME,
      },
      FULL_NAMES,
    );

    expect(name.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
    expect(name.endsWith(" (10.18.166.51)")).toBe(true);
  });

  test("the retried name is a prefix of the name the row showed, plus the address", () => {
    /*
     * THE HONEST STATEMENT OF THE WYSIWYG CONTRACT, which the retry bends.
     *
     * The row shows `buildDeviceName(entry, scan)`, and "a 253-character PTR name is
     * shown clamped, exactly as it is created" is true only of the FIRST
     * create. On a name collision — the wildcard-PTR case the retry exists for,
     * so the case where it happens most — the device is created as
     * `buildFallbackDeviceName(entry, scan)` instead, and the operator's inventory
     * ends up holding a name that is NOT character-for-character the one the
     * row displayed. The dialog does not say so.
     *
     * What survives, and what an operator can actually rely on, is narrower:
     *   - the row shows the name the import ATTEMPTS FIRST;
     *   - the created name is that name, or the longest prefix of it that
     *     leaves room, with ` (<address>)` appended.
     * So the row's text is still the right thing to search the inventory for,
     * and the address in the suffix is what identifies WHICH of the alike-named
     * hosts this device is. Both halves are asserted, exactly, below.
     *
     * `expect(created.startsWith(shown))` would NOT do: it is false for the
     * maximal name, where 15 characters of the shown name are cut to make room.
     * And a bare `endsWith(suffix)` check would pass for a fallback of
     * "x (10.18.166.51)", which carries none of the name at all.
     */
    const suffix: string = " (10.18.166.51)";
    const budget: number = MAX_DEVICE_NAME_LENGTH - suffix.length;

    // Short name: the created name contains the shown name whole.
    const shortHost: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.51",
      dnsHostname: "dhcp-pool.corp.example.com",
    };
    const shortShown: string = buildDeviceName(shortHost, FULL_NAMES);
    const shortCreated: string = buildFallbackDeviceName(shortHost, FULL_NAMES);

    expect(shortShown.length).toBeLessThanOrEqual(budget);
    expect(shortCreated).toBe(`${shortShown}${suffix}`);

    // Maximal name: the base is cut, and cut to the LONGEST prefix that fits.
    const longHost: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.51",
      dnsHostname: LONG_PTR_NAME,
    };
    const longShown: string = buildDeviceName(longHost, FULL_NAMES);
    const longCreated: string = buildFallbackDeviceName(longHost, FULL_NAMES);

    expect(longShown.length).toBeGreaterThan(budget);
    expect(longCreated.endsWith(suffix)).toBe(true);

    const longBase: string = longCreated.substring(
      0,
      longCreated.length - suffix.length,
    );

    expect(longBase).toBe(longShown.substring(0, budget));
    expect(longShown.startsWith(longBase)).toBe(true);
    expect(longBase).toHaveLength(budget);
  });
});

/*
 * OneUptime issue #3678: "wb-0660-kds01.wbhq.com" should import as
 * "wb-0660-kds01", with the FQDN kept rather than thrown away.
 *
 * Everything here runs the row's own statements (rowNamesFor) with a scan
 * standing in for the one the dialog reviews, so what is asserted is what the
 * operator would see — the name line, and the names beside the address.
 */
describe("a scan set to short device names shows them in the Review dialog (issue #3678)", () => {
  /*
   * The reporter's host, as the probe reports it: no SNMP, named only by its
   * PTR record under the one corporate domain every device on the estate
   * shares.
   */
  const reporterHost: DiscoveredNetworkDevice = {
    ipAddress: "10.18.167.31",
    dnsHostname: "wb-0660-kds01.wbhq.com",
    snmpReachable: false,
  };

  test("the reporter's row reads as the short name, with the FQDN beside the address", () => {
    expect(rowNamesFor(reporterHost, SHORT_NAMES)).toEqual({
      displayName: "wb-0660-kds01",
      extraNames: ["wb-0660-kds01.wbhq.com"],
    });
  });

  test("the same row under a scan that did not ask reads exactly as before", () => {
    /*
     * Opt-in, and the default is off: every scan that existed before the
     * column keeps the name line it had, and nothing appears beside the
     * address that was not there before.
     */
    expect(rowNamesFor(reporterHost, FULL_NAMES)).toEqual({
      displayName: "wb-0660-kds01.wbhq.com",
      extraNames: [],
    });
    expect(rowNamesFor(reporterHost, {})).toEqual({
      displayName: "wb-0660-kds01.wbhq.com",
      extraNames: [],
    });
  });

  test("the reported rows shorten, and the address-only row is left alone", () => {
    expect(displayedNames(reportedHosts(), SHORT_NAMES)).toEqual([
      "core-gw",
      "printer-3",
      "cam-lobby",
      // An address is never shortened: "10.18.166.55" is not "10".
      "10.18.166.55",
    ]);

    expect(
      normalizeDiscoveredHosts(reportedHosts()).map(
        (host: DiscoveredNetworkDevice): Array<string> => {
          return extraNamesFor(host, SHORT_NAMES);
        },
      ),
    ).toEqual([
      ["core-gw.corp.example.com"],
      ["printer-3.corp.example.com"],
      ["cam-lobby.corp.example.com"],
      [],
    ]);
  });

  test("only an exact true turns short names on", () => {
    /*
     * The scan arrives as an API row, so a flag that is a string or a number
     * is a real possibility — and it must not rename a project's imports.
     * The row hands the builder the scan verbatim, which is what makes the
     * builder's `=== true` the rule here too.
     */
    for (const notTrue of ["true", 1, null, undefined]) {
      expect(
        rowNamesFor(reporterHost, {
          useShortDeviceNames: notTrue,
        } as unknown as DiscoveredHostNaming).displayName,
      ).toBe("wb-0660-kds01.wbhq.com");
    }
  });

  test("a FQDN sysName is shortened too, and printed once when the PTR record agrees", () => {
    /*
     * Network gear routinely reports its FQDN as sysName, and a list where
     * only the PTR-named hosts were shortened would read as broken. When the
     * sysName and the PTR record are the same name, the second line carries
     * it once — not "core-sw-01.corp.example.com · core-sw-01.corp.example.com".
     */
    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      {
        ipAddress: "10.0.0.5",
        sysName: "core-sw-01.corp.example.com",
        dnsHostname: "core-sw-01.corp.example.com",
        snmpReachable: true,
      },
    ])[0]!;

    expect(rowNamesFor(host, SHORT_NAMES)).toEqual({
      displayName: "core-sw-01",
      extraNames: ["core-sw-01.corp.example.com"],
    });
  });

  test("a sysName and PTR record that disagree are both still shown, full name first", () => {
    /*
     * Shortening the name line must not be what hides a stale reverse zone.
     * The full sysName comes first because it is the name the line above was
     * cut from; the PTR record follows because it is a different name
     * altogether, exactly as it was before short names existed.
     */
    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      {
        ipAddress: "10.0.0.5",
        sysName: "core-sw-01.corp.example.com",
        dnsHostname: "sw1.corp.example.com",
        snmpReachable: true,
      },
    ])[0]!;

    expect(rowNamesFor(host, SHORT_NAMES)).toEqual({
      displayName: "core-sw-01",
      extraNames: ["core-sw-01.corp.example.com", "sw1.corp.example.com"],
    });

    // And with short names off, the row says what it always said.
    expect(rowNamesFor(host, FULL_NAMES)).toEqual({
      displayName: "core-sw-01.corp.example.com",
      extraNames: ["sw1.corp.example.com"],
    });
  });

  test("a sysName that is not a hostname keeps its name and gains nothing", () => {
    /*
     * "Core Switch" has a space and "ubuntu-22.04" ends in a label that is not
     * a top-level domain: neither is shortened, so the name line IS the full
     * name and there is nothing cut off it to show. A disagreeing PTR record
     * still appears, in full — the short-name option shortens the device's
     * NAME, not the names printed beside the address.
     */
    expect(
      rowNamesFor(
        {
          ipAddress: "10.0.0.5",
          sysName: "Core Switch",
          dnsHostname: "sw1.corp.example.com",
          snmpReachable: true,
        },
        SHORT_NAMES,
      ),
    ).toEqual({
      displayName: "Core Switch",
      extraNames: ["sw1.corp.example.com"],
    });

    expect(
      rowNamesFor(
        { ipAddress: "10.0.0.6", sysName: "ubuntu-22.04", snmpReachable: true },
        SHORT_NAMES,
      ),
    ).toEqual({ displayName: "ubuntu-22.04", extraNames: [] });
  });

  test("a host with no name, or a hostile one, is its address and nothing more", () => {
    for (const host of [
      { ipAddress: "10.18.166.55", snmpReachable: false },
      { ipAddress: "10.18.166.55", dnsHostname: "<script>alert(1)</script>" },
      { ipAddress: "10.18.166.55", dnsHostname: "51.166.18.10.in-addr.arpa" },
    ] as Array<DiscoveredNetworkDevice>) {
      expect(rowNamesFor(host, SHORT_NAMES)).toEqual({
        displayName: "10.18.166.55",
        extraNames: [],
      });
    }
  });

  test("a maximal PTR name shortens to its first label, and stays readable in full", () => {
    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      { ipAddress: "10.18.166.51", dnsHostname: LONG_PTR_NAME },
    ])[0]!;

    expect(rowNamesFor(host, SHORT_NAMES)).toEqual({
      displayName: "a".repeat(63),
      extraNames: [LONG_PTR_NAME],
    });
  });

  test("an over-long sysName is readable in full beside the address", () => {
    /*
     * The clamp cuts sysName as well as PTR names, and a sysName is a
     * DisplayString of up to 255 octets. Before the full name was shown
     * beside the address, the tail of such a sysName existed nowhere on the
     * row unless the PTR record happened to repeat it; now it is shown whenever
     * the name line is not the whole of it, whatever the naming choice.
     */
    const longSysName: string = `Core Switch ${"x".repeat(90)}`;
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.5",
      sysName: longSysName,
      snmpReachable: true,
    };

    for (const naming of [FULL_NAMES, SHORT_NAMES]) {
      expect(rowNamesFor(host, naming)).toEqual({
        displayName: longSysName.substring(0, MAX_DEVICE_NAME_LENGTH),
        extraNames: [longSysName],
      });
    }
  });

  test("the checkbox announces the short name the row shows", () => {
    expect(ariaLabelFor(reporterHost, SHORT_NAMES)).toBe(
      "Import wb-0660-kds01 (10.18.167.31)",
    );
    expect(ariaLabelFor(reporterHost, FULL_NAMES)).toBe(
      "Import wb-0660-kds01.wbhq.com (10.18.167.31)",
    );
  });

  test("the device the import builds from the same scan carries the row's name and the FQDN", () => {
    /*
     * WYSIWYG under the new option: the operator ticks "wb-0660-kds01" and
     * gets a device called "wb-0660-kds01" — with the full name kept on it as
     * its DNS Name, which is the half of the issue that says the FQDN must not
     * simply be thrown away.
     */
    const host: DiscoveredNetworkDevice = normalizeDiscoveredHosts([
      reporterHost,
    ])[0]!;

    const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
      projectId: new ObjectID("00000000-0000-0000-0000-000000000001"),
      host: host,
      scan: SHORT_NAMES,
    });

    expect(device.name).toBe(rowNamesFor(host, SHORT_NAMES).displayName);
    expect(device.name).toBe("wb-0660-kds01");
    expect(device.dnsName).toBe("wb-0660-kds01.wbhq.com");
    expect(device.hostname).toBe("10.18.167.31");
  });

  test("the collision retry and the Ping monitor name are the short name plus the address", () => {
    /*
     * Short names make collisions MORE likely: "web" under corp and under lab
     * is one name. The retry is what keeps both importable, and it must build
     * from the short name the row showed — not fall back to the FQDN the scan
     * was told not to use. The Ping monitor is named by the same function, so
     * this is its name too.
     */
    const hosts: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts([
      { ipAddress: "10.0.0.5", dnsHostname: "web.corp.example.com" },
      { ipAddress: "10.0.0.6", dnsHostname: "web.lab.example.com" },
    ]);

    expect(
      hosts.map((host: DiscoveredNetworkDevice): string => {
        return rowNamesFor(host, SHORT_NAMES).displayName;
      }),
    ).toEqual(["web", "web"]);

    expect(
      hosts.map((host: DiscoveredNetworkDevice): string => {
        return buildFallbackDeviceName(host, SHORT_NAMES);
      }),
    ).toEqual(["web (10.0.0.5)", "web (10.0.0.6)"]);

    // Under full names the same hosts never collided, and still do not.
    expect(
      hosts.map((host: DiscoveredNetworkDevice): string => {
        return buildFallbackDeviceName(host, FULL_NAMES);
      }),
    ).toEqual([
      "web.corp.example.com (10.0.0.5)",
      "web.lab.example.com (10.0.0.6)",
    ]);
  });
});

describe("Discovery.tsx wires the row to the shared recipe", () => {
  /*
   * What execution above cannot see: that the computed values are actually
   * RENDERED, and that the old inline rule is gone. Matched against the
   * ELEMENT that carries the behaviour rather than a bare identifier, because
   * every one of these names also appears in a template literal or an
   * aria-label somewhere on the page.
   */

  test("comments are stripped, so prose about a rule cannot pass for the rule", () => {
    /*
     * Every assertion below rests on this. The page is unusually heavily
     * commented, and its comments name buildFallbackDeviceName, the clamp and
     * the wildcard-PTR story in so many words — if the stripper silently
     * stopped working (an unterminated block comment, a changed regex), the
     * whole describe would go green against the prose alone.
     *
     * "dhcp-pool.corp.example.com" sits inside the comment that separates the
     * create's `catch` from the fallback assignment, which is the one comment
     * the retry assertion at the bottom of this file depends on being removed.
     *
     * This couples two assertions to two comment WORDINGS: reword either
     * comment in Discovery.tsx and this test fails for a reason unrelated to
     * behaviour. That is deliberate — it fails loudly, in the direction that
     * cannot let a broken stripper through silently.
     */
    const code: string = readCode();

    expect(readSource()).toContain("WYSIWYG");
    expect(code).not.toContain("WYSIWYG");
    expect(readSource()).toContain("dhcp-pool.corp.example.com");
    expect(code).not.toContain("dhcp-pool.corp.example.com");
  });

  test("the stripper also removes line comments, and spares URLs", () => {
    /*
     * The test above only proves the BLOCK-comment branch, because nothing
     * banned or matched by this file currently lives in a `//` comment on
     * Discovery.tsx. The day one does, the stripper's second regex becomes
     * load-bearing with nothing having ever checked it — so it is checked
     * here, on a synthetic input, along with the `[^:]` guard that is the only
     * reason it does not eat the rest of a line containing "https://".
     */
    const sample: string = [
      "const displayName = entry.sysName || entry.ipAddress; // WYSIWYG",
      'const docs: string = "https://oneuptime.com/docs";',
    ].join("\n");

    const stripped: string = stripComments(sample);

    expect(stripped).not.toContain("WYSIWYG");
    expect(stripped).toContain("entry.sysName || entry.ipAddress");
    expect(stripped).toContain('"https://oneuptime.com/docs"');
  });

  test("the page imports the shared name builders", () => {
    const code: string = readCode();

    expect(code).toMatch(
      /import\s*\{[^}]*\bbuildDeviceName\b[^}]*\}\s*from\s*"Common\/Utils\/NetworkDiscovery\/DiscoveredDeviceBuilder"/,
    );
    expect(code).toMatch(
      /import\s*\{[^}]*\bbuildFallbackDeviceName\b[^}]*\}\s*from\s*"Common\/Utils\/NetworkDiscovery\/DiscoveredDeviceBuilder"/,
    );
    expect(code).toMatch(
      /import\s*\{[^}]*\bnormalizeReverseDnsName\b[^}]*\}\s*from\s*"Common\/Utils\/NetworkDiscovery\/ReverseDnsNameUtil"/,
    );
    expect(code).toMatch(
      /import\s*\{[^}]*\bgetDiscoveredHostFullName\b[^}]*\}\s*from\s*"Common\/Utils\/NetworkDiscovery\/DiscoveredDeviceBuilder"/,
    );
  });

  test("the page no longer re-spells the naming rule anywhere", () => {
    /*
     * `entry.sysName || entry.ipAddress` was the old name line AND the old
     * aria-label. Both are now the shared builder, so neither may survive
     * anywhere on the page — including in the checkbox label, which is what a
     * screen-reader user hears instead of the visible name.
     *
     * Written as ONE whitespace-tolerant regex rather than as two toContain
     * calls. readCode() squashes every whitespace run to a single space, so a
     * `not.toContain("entry.sysName||entry.ipAddress")` matched a string the
     * page can never produce and could not fail; the regex covers both
     * spellings and can.
     *
     * getDiscoveredHostDisplayName is banned for the newer reason: it is the
     * UNCLAMPED name, and rendering it is precisely the WYSIWYG break the row
     * was changed to fix. The name-line assertion below only guards the name
     * DIV, so this ban is what stops the unclamped value reappearing in the
     * aria-label or the hover title. It still exists and is still the right
     * function for a caller that wants the unclamped name — just not for this
     * row.
     *
     * getDiscoveredHostFullName is the one unclamped name the row DOES use
     * (issue #3678), and only for the second line: it is what the name line
     * was cut from, shown in full beside the address when the two differ. It
     * is called exactly once, in the row, so it cannot drift into the name
     * line or the import by accident; the wiring tests below check it is
     * never the value of the title or the aria-label.
     */
    const code: string = readCode();

    expect(code).not.toMatch(/entry\.sysName\s*\|\|\s*entry\.ipAddress/);
    expect(code).not.toContain("getDiscoveredHostDisplayName");
    expect(code.split("getDiscoveredHostFullName(").length - 1).toBe(1);
    expect(rowNameSource().statements).toContain(
      "getDiscoveredHostFullName(entry)",
    );
  });

  test("the unshortened name never stands in for the name line", () => {
    /*
     * The full name belongs beside the address. If the hover title or the
     * checkbox label interpolated it instead of the display name, a sighted
     * operator and a screen-reader user would be told the host is called
     * "wb-0660-kds01.wbhq.com" by a row that creates "wb-0660-kds01".
     */
    const statements: string = rowNameSource().statements;
    const fullNameDeclaration: RegExpMatchArray | null = statements.match(
      /const\s+(\w+)\s*(?::[^=]*)?=\s*getDiscoveredHostFullName\(entry\);/,
    );

    expect(fullNameDeclaration).not.toBeNull();

    const fullNameIdentifier: string = fullNameDeclaration![1]!;

    expect(fullNameIdentifier).not.toBe(rowNameSource().displayNameIdentifier);
    expect(ariaLabelTemplate()).not.toContain(`\${${fullNameIdentifier}}`);
    expect(readCode()).not.toMatch(
      new RegExp(`title=\\{${fullNameIdentifier}\\}`),
    );
  });

  test("the name line renders the clamped builder's answer, truncated with a title", () => {
    /*
     * Three things on one element, because they only work together:
     *
     *   - the display name INSIDE the name div. Asserting the bare identifier
     *     is not enough: the aria-label interpolates it too, so that assertion
     *     stays green with the visible name line deleted.
     *   - `truncate`, because a 253-character FQDN where a 15-character
     *     address used to be will otherwise paint straight across the
     *     "No SNMP" and "Already added" badges on the right of the row.
     *   - `title=`, because truncation hides the tail and the hover is the
     *     only way left to read it.
     *
     * The identifier is read out of the source (see rowNameSource), so a
     * rename cannot fail this test while the behaviour is unchanged.
     */
    const identifier: string = rowNameSource().displayNameIdentifier;

    expect(readCode()).toMatch(
      new RegExp(
        `<div\\s+className="truncate[^"]*"\\s+title=\\{${identifier}\\}\\s*>\\s*\\{${identifier}\\}\\s*</div>`,
      ),
    );
  });

  test("the name line and the aria-label use the same computed value", () => {
    /*
     * One variable, used twice. A sighted operator and a screen-reader user
     * must be told the same thing about the same row — and the label tests
     * above are running this very template, so if it interpolated something
     * other than the name line they would report a different string.
     */
    expect(ariaLabelTemplate()).toContain(
      `\${${rowNameSource().displayNameIdentifier}}`,
    );
    expect(ariaLabelTemplate()).toContain('${entry.ipAddress || "no address"}');
  });

  test("the row still renders the address, on its own truncating line", () => {
    /*
     * `{entry.ipAddress}` on its own is satisfied by the row key and by the
     * failure messages, which interpolate `${entry.ipAddress}` — so the match
     * is anchored to the truncating div that actually paints the line. It
     * truncates for the same reason the name line does: the second line now
     * carries the address AND a PTR name that can run to 253 characters.
     */
    expect(readCode()).toMatch(
      /<div\s+className="truncate[^"]*"\s*>\s*\{entry\.ipAddress\}/,
    );
  });

  test("the second line the tests executed is the second line the row renders", () => {
    /*
     * The gap the lifted-and-run tests cannot close on their own: the row
     * could compute its second-line values perfectly and render none of them.
     * rowNameSource reads the identifiers it runs OFF the rendered spans, so
     * this pins the other direction — that the address line carries those
     * gated spans and nothing else. A raw `{entry.dnsHostname}` beside the
     * address, or a separator printed with nothing after it, fails here.
     *
     * The shape assertion uses a backreference rather than literal names, so
     * it pins the RULE — "the normalised PTR name, only when it is neither the
     * name line nor the full name already shown" — and not the spelling of
     * local variables.
     */
    const source: RowNameSource = rowNameSource();

    // Normalised at the point of render, not trusted from the jsonb column.
    expect(source.statements).toContain(
      "normalizeReverseDnsName(entry.dnsHostname)",
    );

    expect(source.secondaryIdentifiers).toHaveLength(2);

    const [fullNameIdentifier, dnsHostnameIdentifier]: Array<string> =
      source.secondaryIdentifiers;

    expect(source.statements).toMatch(
      new RegExp(
        `const\\s+${fullNameIdentifier}\\s*(?::[^=]*)?=\\s*(\\w+)\\s*!==\\s*${source.displayNameIdentifier}\\s*\\?\\s*\\1\\s*:\\s*undefined`,
      ),
    );

    expect(source.statements).toMatch(
      new RegExp(
        `const\\s+${dnsHostnameIdentifier}\\s*(?::[^=]*)?=\\s*(\\w+)\\s*&&\\s*\\1\\s*!==\\s*${source.displayNameIdentifier}\\s*&&\\s*\\1\\s*!==\\s*${fullNameIdentifier}\\s*\\?\\s*\\1\\s*:\\s*undefined`,
      ),
    );

    // Nothing but the gated names is printed after the address.
    expect(addressLineContent().replace(SECONDARY_NAME_SPAN, "").trim()).toBe(
      "",
    );
  });

  test("a failed create is retried once under the address-qualified name", () => {
    /*
     * The wildcard-PTR collision, pinned in the source because the App suite
     * cannot run importSelectedDevices. What has to hold is the SHAPE: the
     * fallback name is assigned inside the create's catch and a second create
     * follows it. `buildFallbackDeviceName` appearing anywhere on the page
     * would not prove any of that — an import that computed the name and
     * never retried would satisfy a bare identifier match.
     */
    expect(readCode()).toMatch(
      /catch\s*\(\s*\w+\s*\)\s*\{\s*device\.name\s*=\s*buildFallbackDeviceName\(\s*entry\s*,\s*\w+\s*,?\s*\);\s*try\s*\{\s*await\s+ModelAPI\.create/,
    );
  });

  test("the row, the import, the retry and the Ping monitor all name by the scan under review", () => {
    /*
     * Issue #3678's WYSIWYG contract, pinned where the App suite can see it.
     * The naming argument is required, so the compiler already insists each
     * call passes SOMETHING — but `{}` compiles too, and would show
     * "wb-0660-kds01" on the row while the retry created
     * "wb-0660-kds01.wbhq.com (10.18.167.31)". So every naming argument on the
     * page has to be the very identifier the row passes, and that identifier
     * has to be the component's review state — the scan the fresh read put
     * there — rather than a local literal.
     */
    const code: string = readCode();
    const naming: string = rowNameSource().namingIdentifier;

    expect(code).toMatch(
      new RegExp(`const\\s*\\[\\s*${naming}\\s*,\\s*set\\w+\\s*\\]\\s*=`),
    );

    // The device the import builds.
    const build: RegExpMatchArray | null = code.match(
      /buildNetworkDeviceFromDiscoveredHost\(\{\s*projectId:[^}]*?host:\s*entry\s*,\s*scan:\s*(\w+)\s*,?\s*\}\)/,
    );

    expect(build?.[1]).toBe(naming);

    // The collision retry.
    const retry: RegExpMatchArray | null = code.match(
      /catch\s*\(\s*\w+\s*\)\s*\{\s*device\.name\s*=\s*buildFallbackDeviceName\(\s*entry\s*,\s*(\w+)\s*,?\s*\);/,
    );

    expect(retry?.[1]).toBe(naming);

    // The Ping monitor's name.
    const monitor: RegExpMatchArray | null = code.match(
      /const\s+monitorSubjectName\s*(?::[^=]*)?=\s*device\.name\s*&&\s*device\.name\s*!==\s*entry\.ipAddress\s*\?\s*buildFallbackDeviceName\(\s*entry\s*,\s*(\w+)\s*,?\s*\)/,
    );

    expect(monitor?.[1]).toBe(naming);

    /*
     * And no naming call anywhere on the page passes anything else — including
     * one added later that none of the patterns above know about.
     */
    const namingCalls: Array<string> = Array.from(
      code.matchAll(
        /\b(?:buildDeviceName|buildFallbackDeviceName)\(([^)]*)\)/g,
      ),
      (call: RegExpMatchArray): string => {
        return call[1]!.replace(/\s+/g, "").replace(/,$/, "");
      },
    );

    expect(namingCalls.length).toBeGreaterThanOrEqual(3);

    for (const args of namingCalls) {
      expect(args).toBe(`entry,${naming}`);
    }
  });

  test("the scan the dialog reviews is fetched with its naming choice", () => {
    /*
     * A column the fresh read does not select arrives as undefined, which the
     * builder reads as "full names" — so a scan set to short names would
     * silently preview and import full ones. The rendered test in
     * Common/Tests/App/Dashboard/DiscoveryReviewInventoryRefresh pins the
     * exact select; this is the source-level half, next to the naming tests
     * that depend on it.
     */
    const code: string = readCode();

    expect(code).toMatch(
      /ModelAPI\.getItem<NetworkDeviceDiscoveryScan>\(\{[^)]*?select:\s*\{[^}]*\buseShortDeviceNames:\s*true\b[^}]*\}/,
    );
    expect(code).toMatch(
      /selectMoreFields=\{\{[^}]*\buseShortDeviceNames:\s*true\b[^}]*\}\}/,
    );
  });
});
