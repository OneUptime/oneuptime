import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  MAX_DEVICE_NAME_LENGTH,
  buildDeviceName,
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
  getDiscoveredHostDisplayName,
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
 * The block between `const <name> = buildDeviceName(entry)` and the row's
 * `return (` is the entirety of what the row computes about names: the clamped
 * display name, the re-normalised PTR name, and the gate that decides whether
 * the PTR name earns a second line. It is self-contained — it touches nothing
 * but `entry` and the two imported builders — which is what makes lifting and
 * running it possible.
 *
 * The identifiers are CAPTURED rather than assumed, so a pure rename of
 * `displayName` or `secondaryDnsHostname` leaves every test here passing while
 * a change of BEHAVIOUR still fails them. That matters: the previous version
 * of this file hard-coded both names, so a rename broke six tests that had no
 * opinion about naming at all.
 */
interface RowNameSource {
  /* The identifier holding `buildDeviceName(entry)` — the visible name line. */
  displayNameIdentifier: string;
  /* The identifier holding the gated PTR name — the row's second line. */
  secondaryIdentifier: string;
  /* The statements themselves, comments stripped and whitespace squashed. */
  statements: string;
}

const ROW_NAME_BLOCK: RegExp =
  /(const\s+(\w+)\s*(?::[^=]*)?=\s*buildDeviceName\(entry\);.*?)return \(/;

let cachedRowNameSource: RowNameSource | null = null;

function rowNameSource(): RowNameSource {
  if (cachedRowNameSource !== null) {
    return cachedRowNameSource;
  }

  const match: RegExpMatchArray | null = readCode().match(ROW_NAME_BLOCK);

  if (!match) {
    throw new Error(
      "Discovery.tsx no longer computes `buildDeviceName(entry)` into a const" +
        " before the discovered-host row's `return (`. The Review dialog's" +
        " name line is what issue #3529 changed; if it moved, move these" +
        " tests with it rather than deleting them.",
    );
  }

  const statements: string = match[1]!;
  /*
   * The LAST const in the block is the second line: the gate is written as
   * `<normalised> && <normalised> !== <displayName> ? <normalised> : undefined`
   * and assigned last. Taken positionally rather than by name for the reason
   * above. If the second line's computation is deleted outright, the last
   * const becomes the normalised PTR name itself — which is ungated, so
   * "a PTR name that IS the name line is not printed twice" fails. That is the
   * intended failure, and it is why deleting the feature cannot go green here.
   */
  const declaredNames: Array<string> = Array.from(
    statements.matchAll(/const\s+(\w+)\s*[:=]/g),
    (declaration: RegExpMatchArray) => {
      return declaration[1]!;
    },
  );

  const secondaryIdentifier: string | undefined =
    declaredNames[declaredNames.length - 1];

  if (!secondaryIdentifier || declaredNames.length < 2) {
    throw new Error(
      `The discovered-host row declares only ${declaredNames.length} name` +
        " const(s); it needs the display name and the gated PTR name.",
    );
  }

  cachedRowNameSource = {
    displayNameIdentifier: match[2]!,
    secondaryIdentifier: secondaryIdentifier,
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

type RowSecondaryLine = (
  entry: DiscoveredNetworkDevice,
  buildName: (host: DiscoveredNetworkDevice) => string,
  normalizeName: (value: unknown) => string | undefined,
) => string | undefined;

let cachedSecondaryLine: RowSecondaryLine | null = null;

/**
 * What the row's second line shows for this host — computed by running the
 * row's own expression, with the real shared builders injected.
 *
 * The parameter names are the page's own call names, so an alias-rename in
 * Discovery.tsx fails the extraction loudly instead of quietly.
 */
function secondaryLineFor(host: DiscoveredNetworkDevice): string | undefined {
  if (cachedSecondaryLine === null) {
    const source: RowNameSource = rowNameSource();

    cachedSecondaryLine = new Function(
      "entry",
      "buildDeviceName",
      "normalizeReverseDnsName",
      `${stripTypeAnnotations(source.statements)} return ${
        source.secondaryIdentifier
      };`,
    ) as unknown as RowSecondaryLine;
  }

  return cachedSecondaryLine(host, buildDeviceName, normalizeReverseDnsName);
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

function ariaLabelFor(host: DiscoveredNetworkDevice): string {
  if (cachedAriaLabel === null) {
    cachedAriaLabel = new Function(
      "entry",
      rowNameSource().displayNameIdentifier,
      `return ${ariaLabelTemplate()};`,
    ) as unknown as RowAriaLabel;
  }

  return cachedAriaLabel(host, buildDeviceName(host));
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
 */
function displayedNames(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return normalizeDiscoveredHosts(hosts).map(
    (host: DiscoveredNetworkDevice) => {
      return buildDeviceName(host);
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
      expect(buildDeviceName(host)).not.toContain(host.ipAddress);
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

    expect(getDiscoveredHostDisplayName(numericSysName)).toBe(
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

    expect(getDiscoveredHostDisplayName(paddedSysName)).toBe(
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
    expect(getDiscoveredHostDisplayName(host)).toHaveLength(253);

    const shownName: string = buildDeviceName(host);

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

    expect(buildDeviceName(host)).toBe("core-switch-01");
    expect(secondaryLineFor(host)).toBe("sw1.corp.example.com");
  });

  test("a PTR name that IS the name line is not printed twice", () => {
    /*
     * The reporter's own rows: no SNMP, so the PTR name is the name line.
     * Repeating it beside the address would make every row in the dialog the
     * feature was built for read as "name / address · name". This is the test
     * that fails if the row's `!== displayName` gate is removed or inverted.
     */
    for (const host of normalizeDiscoveredHosts(reportedHosts())) {
      expect(secondaryLineFor(host)).toBeUndefined();
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

    expect(buildDeviceName(raw)).toBe("core-gw.corp.example.com");
    expect(secondaryLineFor(raw)).toBeUndefined();
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

    expect(buildDeviceName(host)).toHaveLength(MAX_DEVICE_NAME_LENGTH);
    expect(secondaryLineFor(host)).toBe(LONG_PTR_NAME);
  });

  test("a host with no usable PTR record has no second line", () => {
    // Nothing to say, so nothing is said: no empty separator on the address.
    expect(
      secondaryLineFor({ ipAddress: "10.18.166.55", snmpReachable: false }),
    ).toBeUndefined();

    /*
     * Fed raw on purpose. A resolver that echoes the query name back hands us
     * "51.166.18.10.in-addr.arpa", which is a legal hostname string and a
     * strictly worse label than the address it came from. The row's own
     * re-normalisation is the thing being tested: render `entry.dnsHostname`
     * instead and this row grows a second line reading the reverse zone.
     */
    expect(
      secondaryLineFor({
        ipAddress: "10.18.166.55",
        dnsHostname: "51.166.18.10.in-addr.arpa",
      }),
    ).toBeUndefined();

    // Same for an answer the character rules reject outright.
    expect(
      secondaryLineFor({
        ipAddress: "10.18.166.55",
        dnsHostname: "<script>alert(1)</script>",
      }),
    ).toBeUndefined();
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
      ariaLabelFor({
        ipAddress: "10.18.166.51",
        dnsHostname: "core-gw.corp.example.com",
        snmpReachable: false,
      }),
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
    expect(ariaLabelFor({ ipAddress: "", sysName: "core-switch-01" })).toBe(
      "Import core-switch-01 (no address)",
    );

    // Nothing to say at all is still a sentence, not an empty one.
    expect(ariaLabelFor({ ipAddress: "" })).toBe("Import  (no address)");
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
        return buildDeviceName(host);
      }),
    ).toEqual([shared, shared]);

    const fallbackNames: Array<string> = hosts.map(
      (host: DiscoveredNetworkDevice) => {
        return buildFallbackDeviceName(host);
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
        return buildDeviceName(host);
      },
    );

    // Both rows read identically, which is what makes the retry necessary.
    expect(new Set<string>(shownNames).size).toBe(1);

    const fallbackNames: Array<string> = hosts.map(
      (host: DiscoveredNetworkDevice) => {
        return buildFallbackDeviceName(host);
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
    const name: string = buildFallbackDeviceName({
      ipAddress: "10.18.166.51",
      dnsHostname: LONG_PTR_NAME,
    });

    expect(name.length).toBeLessThanOrEqual(MAX_DEVICE_NAME_LENGTH);
    expect(name.endsWith(" (10.18.166.51)")).toBe(true);
  });

  test("the retried name is a prefix of the name the row showed, plus the address", () => {
    /*
     * THE HONEST STATEMENT OF THE WYSIWYG CONTRACT, which the retry bends.
     *
     * The row shows `buildDeviceName(entry)`, and "a 253-character PTR name is
     * shown clamped, exactly as it is created" is true only of the FIRST
     * create. On a name collision — the wildcard-PTR case the retry exists for,
     * so the case where it happens most — the device is created as
     * `buildFallbackDeviceName(entry)` instead, and the operator's inventory
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
    const shortShown: string = buildDeviceName(shortHost);
    const shortCreated: string = buildFallbackDeviceName(shortHost);

    expect(shortShown.length).toBeLessThanOrEqual(budget);
    expect(shortCreated).toBe(`${shortShown}${suffix}`);

    // Maximal name: the base is cut, and cut to the LONGEST prefix that fits.
    const longHost: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.51",
      dnsHostname: LONG_PTR_NAME,
    };
    const longShown: string = buildDeviceName(longHost);
    const longCreated: string = buildFallbackDeviceName(longHost);

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
     * aria-label, the hover title or the second line. It still exists and is
     * still the right function for a caller that wants the full name — just
     * not for this row.
     */
    const code: string = readCode();

    expect(code).not.toMatch(/entry\.sysName\s*\|\|\s*entry\.ipAddress/);
    expect(code).not.toContain("getDiscoveredHostDisplayName");
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
     * could compute `secondaryDnsHostname` perfectly and render none of it.
     * So the identifier that those tests took their answer from is required to
     * appear, gated, inside the span beside the address.
     *
     * The shape assertions use a backreference rather than literal names, so
     * they pin the RULE — "the normalised PTR name, and only when it differs
     * from the name line" — and not the spelling of two local variables.
     */
    const source: RowNameSource = rowNameSource();
    const code: string = readCode();

    // Normalised at the point of render, not trusted from the jsonb column.
    expect(source.statements).toContain(
      "normalizeReverseDnsName(entry.dnsHostname)",
    );

    expect(source.statements).toMatch(
      new RegExp(
        `(\\w+)\\s*&&\\s*\\1\\s*!==\\s*${source.displayNameIdentifier}\\s*\\?\\s*\\1\\s*:\\s*undefined`,
      ),
    );

    // Rendered, and rendered conditionally: no bare separator on the address.
    expect(code).toMatch(new RegExp(`\\{${source.secondaryIdentifier}\\s*&&`));
    expect(code).toMatch(
      new RegExp(`\\{${source.secondaryIdentifier}\\}\\s*</span>`),
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
      /catch\s*\(\s*\w+\s*\)\s*\{\s*device\.name\s*=\s*buildFallbackDeviceName\(entry\);\s*try\s*\{\s*await\s+ModelAPI\.create/,
    );
  });
});
