import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * The SNMP / No SNMP filter added for issue #3322 is only half a feature in
 * DiscoveredHostFilter.ts. The other half is the wiring in Discovery.tsx, and
 * that half has one failure mode that costs real money:
 *
 *   Import must be scoped to the group on screen. The dialog opens with every
 *   host pre-checked, so if the Import path stops going through
 *   `getDiscoveredHostsToImport` with the ACTIVE filter — if someone
 *   "simplifies" it back to filtering `selectedIps` inline, as it did before —
 *   then narrowing to SNMP and pressing Import silently creates the thousands
 *   of ping-only devices the operator just filtered away. Nothing throws. The
 *   dialog even says it succeeded.
 *
 * Its twin: the count on the submit button has to be computed the same way, or
 * the button promises one number and the press does another.
 *
 * The App suite runs in a plain Node environment with no React renderer (see
 * jest.config.json), so the dialog cannot be mounted and clicked. This pins
 * the JSX wiring at source level instead, the same fs/path approach
 * InventoryTableInvariants.test.ts and NetworkFormStepsInvariants.test.ts use.
 * Whitespace is squashed so Prettier can reflow props without making the test
 * brittle, and comments are stripped so that describing a rule in prose never
 * counts as implementing it.
 *
 * THIS FILE'S TERRITORY is the filter row, the bulk selection control and the
 * submit-button count. The dialog LIFECYCLE — the close gate, the stale-run
 * guard, the per-scan imported-address overlay and row identity — is pinned by
 * DiscoveryReviewLifecycleInvariants.test.ts, and the user-visible copy by
 * DiscoveryReviewCopy.test.ts.
 *
 * ON SLICING, which is how a file like this rots: every `indexOf` used to cut
 * a section out of the source is asserted to have found something. An
 * unguarded -1 turns `slice` into "from the start of the file" or "the empty
 * string", and every assertion under it then passes for a reason that has
 * nothing to do with the rule it names. `section()` below refuses to return a
 * slice it could not locate.
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

/**
 * The text between two markers, with both markers proven to exist.
 *
 * A rename that moves a marker fails the test loudly here instead of quietly
 * widening or emptying the slice underneath it.
 */
function section(startMarker: string, endMarker: string): string {
  const code: string = readCode();

  const start: number = code.indexOf(startMarker);
  const end: number = code.indexOf(endMarker, start + startMarker.length);

  expect({ marker: startMarker, found: start > -1 }).toEqual({
    marker: startMarker,
    found: true,
  });
  expect({ marker: endMarker, found: end > -1 }).toEqual({
    marker: endMarker,
    found: true,
  });

  return code.slice(start, end);
}

/** The body of `importSelectedDevices`, up to the render return. */
function importSection(): string {
  return section("const importSelectedDevices", "if (isLoading)");
}

/** Everything the Review Discovered Devices modal renders. */
function modalSection(): string {
  const code: string = readCode();
  const start: number = code.indexOf('title="Review Discovered Devices"');

  expect(start).toBeGreaterThan(-1);

  return code.slice(start);
}

/** The bulk Select all / Clear all control alone, not the rows below it. */
function bulkControlSection(): string {
  return section("<Button title={", "/> </div>");
}

/** One rendered row of the discovered-host list. */
function rowSection(): string {
  return section("{shownEntries.map(", "</div> ); }, )}");
}

describe("the Review Discovered Devices dialog imports only what it is showing", () => {
  test("the import path goes through the filter-scoped helper", () => {
    const code: string = importSection();

    expect(code).toContain("getDiscoveredHostsToImport({");
    expect(code).toContain("filter: hostFilter");
  });

  test("import does not re-implement the selection rule inline", () => {
    /*
     * The predicate this replaced — `entry.ipAddress && !isAlreadyRegistered
     * && isImportableDiscoveredHost(entry) && selectedIps[entry.ipAddress]` —
     * had no idea a filter existed. Re-growing it anywhere in the import path
     * is exactly how the scoping silently comes undone.
     */
    expect(importSection()).not.toContain("selectedIps[entry.ipAddress]");
  });

  test("the button's count is computed the same way the import is", () => {
    /*
     * Asserted as one contiguous string rather than three independent
     * substring checks: `getDiscoveredHostsToImport` and `filter: hostFilter`
     * both appear elsewhere in the file, so checking for them separately would
     * survive a mutant that computed the count from an unfiltered list.
     */
    const declaration: string = section(
      "const selectedCount: number =",
      "const selectableShownCount",
    );

    expect(declaration).toContain(
      "getDiscoveredHostsToImport({ hosts: reviewEntries, filter: hostFilter, selectedIpAddresses: selectedIps, })",
    );
    expect(declaration).toContain(".length");
  });

  test("the submit button shows that count and refuses an empty import", () => {
    const code: string = modalSection();

    expect(code).toContain(
      "submitButtonText={`Import Selected (${selectedCount})`}",
    );
    expect(code).toContain("disableSubmitButton={selectedCount === 0}");
  });
});

describe("the filter row", () => {
  test("the dialog renders FilterButtons bound to the filter state", () => {
    const code: string = section("<FilterButtons", "/>");

    expect(code).toContain("options={hostFilterOptions}");
    expect(code).toContain("selectedValue={hostFilter}");
    expect(code).toContain("setHostFilter(value as DiscoveredHostFilter)");
  });

  test("the buttons and their counts come from the tested helper", () => {
    // Not hand-built in JSX, where the counts could drift from the groups.
    const declaration: string = section(
      "const hostFilterOptions",
      "const shownEntries",
    );

    expect(declaration).toContain(
      "getDiscoveredHostFilterOptions(reviewEntries)",
    );
  });

  test("the list renders the filtered hosts, not the whole scan", () => {
    const code: string = modalSection();

    expect(code).toContain("{shownEntries.map(");
    expect(code).not.toContain("{reviewEntries.map(");
  });

  test("shownEntries is the filter applied to the scan, carrying scan position", () => {
    /*
     * getShownDiscoveredHosts rather than filterDiscoveredHosts: the rows need
     * their position in the UNFILTERED scan for a React key that does not move
     * when the filter does. See ShownDiscoveredHost.
     */
    const declaration: string = section(
      "const shownEntries",
      "const selectedCount",
    );

    expect(declaration).toContain(
      "getShownDiscoveredHosts({ hosts: reviewEntries, filter: hostFilter, })",
    );
  });

  test("every group size is computed off the unfiltered scan", () => {
    /*
     * Deriving the badges from the filtered list would make every button
     * except the active one read zero — and the badges are what you click to
     * change the filter.
     */
    const declaration: string = section(
      "const hostFilterOptions",
      "const shownEntries",
    );

    expect(declaration).not.toContain("shownEntries");
  });
});

describe("the bulk selection control", () => {
  test("it exists and is addressable", () => {
    expect(bulkControlSection()).toContain(
      'dataTestId="discovered-device-select-all"',
    );
  });

  test("it toggles the shown group, and only the shown group", () => {
    const code: string = bulkControlSection();

    expect(code).toContain(
      "toggleSelectionForShownHosts({ hosts: reviewEntries, filter: hostFilter, selectedIpAddresses: current, })",
    );
  });

  test("it is disabled when the shown group has nothing to select", () => {
    expect(bulkControlSection()).toContain(
      "disabled={selectableShownCount === 0 || isImporting}",
    );
  });

  test("a full group offers Clear all and a partial one offers Select all", () => {
    /*
     * Pinned as the whole ternary, both arms and their direction. Asserting
     * only that the identifier `areAllShownSelected` appears — which is what
     * this test used to do — passes just as happily with the two arms swapped,
     * i.e. with a button that says "Select all" over an already-full group and
     * clears it when pressed.
     */
    expect(bulkControlSection()).toContain(
      "title={ areAllShownSelected " +
        '? `Clear all (${selectableShownCount.toLocaleString("en-US")})` ' +
        ': `Select all (${selectableShownCount.toLocaleString("en-US")})` }',
    );
  });

  test("it updates selection functionally, not from a captured value", () => {
    /*
     * Scoped to the bulk control's own JSX. The per-row checkbox uses the same
     * functional form a few lines below, so a file-wide search for it would
     * pass even after the bulk control was rewritten to spread a stale
     * `selectedIps` — which would drop the work of a first press when a second
     * landed in the same tick.
     */
    expect(bulkControlSection()).toContain(
      "setSelectedIps((current: Record<string, boolean>) =>",
    );
  });
});

describe("each row agrees with the counts above it", () => {
  test("the row badge is decided by the same predicate the filter groups by", () => {
    /*
     * Pinned as the exact assignment. Asserting only that the substring
     * `isPingOnlyDiscoveredHost(entry)` occurs somewhere survives a leading
     * `!` — which is precisely how a badged row and a filtered row come to be
     * different sets.
     */
    expect(rowSection()).toContain(
      "const isPingOnly: boolean = isPingOnlyDiscoveredHost(entry);",
    );
  });

  test("the checkbox's enabled state is the shared selectability rule", () => {
    /*
     * Every count, the bulk toggle and the import list go through
     * isSelectableDiscoveredHost. The row used to spell out its own version of
     * that rule, which left a host with a blank address rendering an enabled
     * checkbox that no count in the dialog agreed existed.
     */
    const code: string = rowSection();

    expect(code).toContain(
      "const isSelectable: boolean = isSelectableDiscoveredHost(entry);",
    );
    expect(code).toContain("disabled={!isSelectable || isImporting}");
    expect(code).not.toContain("!isImportable");
  });

  test("a row that cannot be selected never renders as ticked", () => {
    const code: string = rowSection();

    expect(code).toContain(
      "const isChecked: boolean = isSelectable && Boolean(selectedIps[entry.ipAddress]);",
    );
  });
});

describe("the page reads the scan through the shared, tested helper", () => {
  test("discoveredDevices is not re-parsed inline", () => {
    /*
     * Discovery.tsx used to carry its own copy of the jsonb guard. Two copies
     * of "what counts as a result array" is one copy too many; the page now
     * uses DiscoveryScanOutcome.getDiscoveredHosts, which has tests covering
     * junk values.
     */
    const code: string = readCode();

    expect(code).toContain("getDiscoveredHosts(");
    expect(code).not.toContain("const getDiscoveredDevices:");
    expect(code).not.toContain("scan?.discoveredDevices");
  });
});
