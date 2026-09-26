import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * OneUptime issue #3916: an ICMP-only scan of twelve kitchen displays named
 * four by reverse DNS and listed the other eight as bare addresses, and
 * nothing anywhere said why. The Review dialog now puts a muted "No name
 * found" and an (i) beside the name line of every unnamed host, and the (i)
 * explains — from per-host codes the probe records, or from what the scan was
 * set to ask — which naming sources were tried and what each came back with.
 *
 * The behaviour is pinned RENDERED in
 * Common/Tests/App/Dashboard/DiscoveryReviewUnnamedHostHint.test.tsx, and the
 * wording by Common's own tests of explainUnnamedDiscoveredHost. This file
 * pins, at source level, the three properties of the WIRING that a rendered
 * test cannot see, the same fs/path approach the other Discovery*Invariants
 * files use:
 *
 *   1. The hint's text comes from explainUnnamedDiscoveredHost and from
 *      nowhere else. The page adds no copy of its own, and interpolates
 *      nothing into it — so nothing a scanned host chose (a PTR name, a
 *      NetBIOS answer, a sysDescr) can ever be written into the tooltip, and
 *      every sentence it shows is one Common's tests have read.
 *
 *   2. It is computed BEFORE `const displayName = buildDeviceName(entry, …)`.
 *      DiscoveryReviewHostname.test.ts lifts the block from that line to the
 *      row's `return (` out of this page and EXECUTES it with only the naming
 *      builders injected. A call to explainUnnamedDiscoveredHost inside that
 *      block would be a ReferenceError there, failing some forty tests that
 *      have no opinion about this feature.
 *
 *   3. The (i) is on the NAME line and not on the address line, whose
 *      content DiscoveryReviewHostname.test.ts pins to exactly "the gated
 *      names and the NetBIOS hint".
 *
 * Comments are stripped so that describing a rule in prose never counts as
 * implementing it, and whitespace is squashed so Prettier can reflow the JSX
 * without making these assertions brittle. Every slice below proves its
 * markers exist before it is used, so a rename fails loudly rather than
 * turning a `not.toContain` into a vacuous pass.
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
 * Read once per run: the page is a file other processes edit, and two halves
 * of one test must not read two different versions of it.
 */
let cachedSource: string | null = null;

function readSource(): string {
  if (cachedSource === null) {
    cachedSource = fs.readFileSync(DISCOVERY_PAGE, "utf8");
  }

  return cachedSource;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The page with comments removed and whitespace squashed to single spaces. */
function readCode(): string {
  return stripComments(readSource()).replace(/\s+/g, " ");
}

/** Where `marker` first appears in the code, proven to exist. */
function indexOf(marker: string | RegExp, from: number = 0): number {
  const code: string = readCode();
  let index: number = -1;

  if (typeof marker === "string") {
    index = code.indexOf(marker, from);
  } else {
    const offset: number = code.slice(from).search(marker);
    index = offset === -1 ? -1 : from + offset;
  }

  expect({ marker: String(marker), found: index > -1 }).toEqual({
    marker: String(marker),
    found: true,
  });

  return index;
}

function count(code: string, needle: string): number {
  return code.split(needle).length - 1;
}

/*
 * The row's naming block exactly as DiscoveryReviewHostname.test.ts cuts it:
 * from the `buildDeviceName(entry, <scan>)` const to the row's `return (`.
 * Kept identical to that file's ROW_NAME_BLOCK on purpose — this is the text
 * that file executes, so this is the text the hint must stay out of.
 */
const ROW_NAME_BLOCK: RegExp =
  /(const\s+(\w+)\s*(?::[^=]*)?=\s*buildDeviceName\(\s*entry\s*,\s*(\w+)\s*,?\s*\);.*?)return \(/;

interface RowNameBlock {
  statements: string;
  displayNameIdentifier: string;
  namingIdentifier: string;
  // Where the block starts in readCode().
  start: number;
}

function rowNameBlock(): RowNameBlock {
  const match: RegExpMatchArray | null = readCode().match(ROW_NAME_BLOCK);

  if (!match || match.index === undefined) {
    throw new Error(
      "Discovery.tsx no longer computes `buildDeviceName(entry, <scan>)` into" +
        " a const before the discovered-host row's `return (`.",
    );
  }

  return {
    statements: match[1]!,
    displayNameIdentifier: match[2]!,
    namingIdentifier: match[3]!,
    start: match.index,
  };
}

/*
 * The one call to explainUnnamedDiscoveredHost, and the identifier it is
 * stored in.
 */
interface ExplanationCall {
  identifier: string;
  hostArgument: string;
  scanArgument: string;
  isGlobalProbeArgument: string;
  index: number;
}

const EXPLANATION_CALL: RegExp =
  /const\s+(\w+)\s*(?::[^=]*)?=\s*explainUnnamedDiscoveredHost\(\{\s*host:\s*(\w+)\s*,\s*scan:\s*(\w+)\s*,\s*isGlobalProbe:\s*(\w+)\s*,?\s*\}\)\s*;/;

function explanationCall(): ExplanationCall {
  const match: RegExpMatchArray | null = readCode().match(EXPLANATION_CALL);

  if (!match || match.index === undefined) {
    throw new Error(
      "Discovery.tsx no longer stores `explainUnnamedDiscoveredHost({ host," +
        " scan, isGlobalProbe })` in a const. The unnamed-host hint (issue" +
        " #3916) is computed once per row, from exactly those three inputs.",
    );
  }

  return {
    identifier: match[1]!,
    hostArgument: match[2]!,
    scanArgument: match[3]!,
    isGlobalProbeArgument: match[4]!,
    index: match.index,
  };
}

/** One rendered row of the discovered-host list. */
function rowSection(): string {
  const code: string = readCode();
  const start: number = indexOf("{shownEntries.map(");
  const end: number = indexOf("</div> ); }, )}", start);

  return code.slice(start, end);
}

/*
 * The name line: the flex wrapper that holds the name div and, on an unnamed
 * row, the label and the (i) — up to the address line that follows it.
 */
function nameLineSection(): string {
  const code: string = readCode();
  const start: number = indexOf('<div className="flex min-w-0 items-center');
  const end: number = indexOf(
    /<div\s+className="truncate[^"]*"\s*>\s*\{entry\.ipAddress\}/,
    start,
  );

  return code.slice(start, end);
}

/** The address line: from `{entry.ipAddress}` to its closing tag. */
function addressLineSection(): string {
  const match: RegExpMatchArray | null = readCode().match(
    /<div\s+className="truncate[^"]*"\s*>\s*\{entry\.ipAddress\}(.*?)<\/div>/,
  );

  expect(match).not.toBeNull();

  return match![1]!;
}

describe("the unnamed-host hint comes from Common and nowhere else (issue #3916)", () => {
  test("the page imports the explanation and the shared (i) from Common", () => {
    const code: string = readCode();

    expect(code).toMatch(
      /import\s*\{[^}]*\bexplainUnnamedDiscoveredHost\b[^}]*\}\s*from\s*"Common\/Utils\/NetworkDiscovery\/DiscoveredHostNamingDiagnosis"/,
    );
    expect(code).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
  });

  test("it is called exactly once, inside the row, for the row's own host", () => {
    const code: string = readCode();
    const call: ExplanationCall = explanationCall();

    expect(count(code, "explainUnnamedDiscoveredHost(")).toBe(1);
    expect(rowSection()).toContain("explainUnnamedDiscoveredHost(");
    expect(call.hostArgument).toBe("entry");
  });

  test("it is handed the same scan the row is named by — the dialog's fresh read", () => {
    /*
     * The scan under review is what selects status, isSnmpEnabled and
     * isNetbiosLookupEnabled for this. A table row, or a literal, would read
     * every legacy host as "NetBIOS off" on a scan that had it on.
     */
    expect(explanationCall().scanArgument).toBe(
      rowNameBlock().namingIdentifier,
    );
    expect(readCode()).toMatch(
      new RegExp(
        `const\\s*\\[\\s*${explanationCall().scanArgument}\\s*,\\s*set\\w+\\s*\\]\\s*=`,
      ),
    );
  });

  test("the tooltip's text is the explanation's text, verbatim", () => {
    /*
     * Not a template literal, not a concatenation, not a ternary with a page
     * default: the explanation's `.text` and nothing else. That is what
     * guarantees nothing host-chosen is ever appended to it.
     */
    const explanation: string = explanationCall().identifier;
    const tooltips: Array<string> = Array.from(
      readCode().matchAll(/<InfoTooltip\b[^>]*\/>/g),
      (match: RegExpMatchArray): string => {
        return match[0];
      },
    );

    expect(tooltips).toHaveLength(1);

    const tooltip: string = tooltips[0]!;

    expect(tooltip).toMatch(
      new RegExp(`\\stext=\\{${explanation}\\.text\\}\\s`),
    );
    // Named after the address it explains, and findable by a test id.
    expect(tooltip).toContain("label={`why ${entry.ipAddress} has no name`}");
    expect(tooltip).toContain(
      "dataTestId={`discovered-device-unnamed-${entry.ipAddress}`}",
    );
  });

  test("the label and the (i) render only when there is an explanation", () => {
    const explanation: string = explanationCall().identifier;

    expect(nameLineSection()).toMatch(
      new RegExp(
        `\\{${explanation}\\s*&&\\s*\\(\\s*<Fragment>\\s*<span\\s+className="[^"]*"\\s*>\\s*\\{${explanation}\\.label\\}\\s*</span>\\s*<InfoTooltip\\b[^>]*/>\\s*</Fragment>\\s*\\)\\s*\\}`,
      ),
    );
  });

  test("the page writes none of the explanation's copy itself", () => {
    /*
     * Every sentence lives in DiscoveredHostNamingDiagnosis, where it is
     * unit-tested. A sentence written here would be one nobody tested, and
     * would drift from the one that was.
     */
    const code: string = readCode();

    for (const phrase of [
      "No name found",
      "Not named yet",
      "Reverse DNS:",
      "NetBIOS:",
      "SNMP:",
      "PTR record for this address",
    ]) {
      expect({ phrase: phrase, found: code.includes(phrase) }).toEqual({
        phrase: phrase,
        found: false,
      });
    }
  });
});

describe("the hint stays out of the naming block the App suite executes", () => {
  test("it is computed before the name line's buildDeviceName, not after", () => {
    expect(explanationCall().index).toBeLessThan(rowNameBlock().start);
    expect(explanationCall().index).toBeGreaterThan(
      indexOf("{shownEntries.map("),
    );
  });

  test("nothing in the lifted block refers to it or to the probe list", () => {
    /*
     * DiscoveryReviewHostname.test.ts runs this block with `entry`, the four
     * naming helpers and the scan injected, and nothing else in scope.
     */
    const statements: string = rowNameBlock().statements;

    expect(statements).not.toContain("explainUnnamedDiscoveredHost");
    expect(statements).not.toContain(explanationCall().identifier);
    expect(statements).not.toContain(explanationCall().isGlobalProbeArgument);
    expect(statements).not.toMatch(/\bprobes\b/);
  });

  test("the global-probe answer is worked out once per render, outside the row", () => {
    /*
     * A fact about the scan, not the host — and a list of thousands of rows
     * must not search the probe list once per row.
     */
    const code: string = readCode();
    const identifier: string = explanationCall().isGlobalProbeArgument;
    const declaration: RegExpMatchArray | null = code.match(
      new RegExp(
        `const\\s+${identifier}\\s*:\\s*boolean\\s*\\|\\s*undefined\\s*=`,
      ),
    );

    expect(declaration).not.toBeNull();

    const start: number = declaration!.index!;

    expect(start).toBeLessThan(indexOf("{shownEntries.map("));
    expect(rowSection()).not.toMatch(/\bprobes\.find\(/);

    /*
     * Read off the loaded probes, matched to the scan's own probe. Sliced up
     * to the page's render `return (`, which follows it: the arrow inside the
     * expression has a `;` and a `return` of its own, so neither can end it.
     */
    const expression: string = code.slice(
      start,
      indexOf("return ( <Fragment>", start),
    );

    expect(expression).toContain("probes.find(");
    expect(expression).toContain(".isGlobalProbe");
    expect(code).toMatch(/scanToReview\?\.probeId\?\.toString\(\)/);
  });
});

describe("the hint is beside the name, and the address line is untouched", () => {
  test("the name div is unchanged inside the new wrapper", () => {
    const identifier: string = rowNameBlock().displayNameIdentifier;

    expect(nameLineSection()).toMatch(
      new RegExp(
        `^<div className="flex min-w-0 items-center[^"]*"\\s*>\\s*<div\\s+className="truncate[^"]*"\\s+title=\\{${identifier}\\}\\s*>\\s*\\{${identifier}\\}\\s*</div>`,
      ),
    );
  });

  test("the address line carries no (i) and no label", () => {
    const addressLine: string = addressLineSection();

    expect(addressLine).not.toContain("InfoTooltip");
    expect(addressLine).not.toContain(explanationCall().identifier);
  });
});

describe("the dialog reads what the explanation needs", () => {
  test("the fresh read selects the scan's NetBIOS setting", () => {
    /*
     * A column missing from the select arrives as undefined, which the
     * explanation reads as "NetBIOS off" — and on a scan that had it on, a
     * row would be told to turn on a lookup that already ran.
     */
    expect(readCode()).toMatch(
      /ModelAPI\.getItem<NetworkDeviceDiscoveryScan>\(\{[^)]*?select:\s*\{[^}]*\bisNetbiosLookupEnabled:\s*true\b[^}]*\}/,
    );
  });

  test("and still selects the other facts it reads", () => {
    const select: RegExpMatchArray | null = readCode().match(
      /ModelAPI\.getItem<NetworkDeviceDiscoveryScan>\(\{[^)]*?select:\s*\{([^}]*)\}/,
    );

    expect(select).not.toBeNull();

    for (const column of [
      "status",
      "probeId",
      "isSnmpEnabled",
      "discoveredDevices",
    ]) {
      expect(select![1]).toMatch(new RegExp(`\\b${column}:\\s*true\\b`));
    }
  });
});
