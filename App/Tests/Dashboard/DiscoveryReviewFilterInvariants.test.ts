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
 *   toast even says it succeeded.
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

/** The body of `importSelectedDevices`, up to the render return. */
function importSection(): string {
  const code: string = readCode();

  return code.slice(
    code.indexOf("const importSelectedDevices"),
    code.indexOf("if (isLoading)"),
  );
}

/** Everything the Review Discovered Devices modal renders. */
function modalSection(): string {
  const code: string = readCode();

  return code.slice(code.indexOf('title="Review Discovered Devices"'));
}

describe("the Review Discovered Devices dialog imports only what it is showing", () => {
  test("the import path goes through the filter-scoped helper", () => {
    const section: string = importSection();

    expect(section).toContain("getDiscoveredHostsToImport({");
    expect(section).toContain("filter: hostFilter");
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
    const code: string = readCode();

    const selectedCountDeclaration: string = code.slice(
      code.indexOf("const selectedCount: number ="),
      code.indexOf("const selectableShownCount"),
    );

    expect(selectedCountDeclaration).toContain("getDiscoveredHostsToImport({");
    expect(selectedCountDeclaration).toContain("filter: hostFilter");
    expect(modalSection()).toContain(
      "submitButtonText={`Import Selected (${selectedCount})`}",
    );
    expect(modalSection()).toContain(
      "disableSubmitButton={selectedCount === 0}",
    );
  });

  test("hosts imported in this sitting are retired from the dialog", () => {
    /*
     * `isAlreadyRegistered` is frozen into the scan's jsonb when the probe
     * uploads. Importing group by group means returning to a list that still
     * contains what you just imported, pre-checked — so the page overlays what
     * it knows through markDiscoveredHostsAsRegistered.
     */
    const code: string = readCode();

    expect(code).toContain("markDiscoveredHostsAsRegistered({");
    expect(importSection()).toContain("setImportedIpAddresses(");
  });
});

describe("the filter row", () => {
  test("the dialog renders FilterButtons bound to the filter state", () => {
    const section: string = modalSection();

    expect(section).toContain("<FilterButtons");
    expect(section).toContain("selectedValue={hostFilter}");
    expect(section).toContain("setHostFilter(value as DiscoveredHostFilter)");
  });

  test("the buttons and their counts come from the tested helper", () => {
    // Not hand-built in JSX, where the counts could drift from the groups.
    expect(readCode()).toContain(
      "getDiscoveredHostFilterOptions(reviewEntries)",
    );
    expect(modalSection()).toContain("options={hostFilterOptions}");
  });

  test("the list renders the filtered hosts, not the whole scan", () => {
    const section: string = modalSection();

    expect(section).toContain("{shownEntries.map(");
    expect(section).not.toContain("{reviewEntries.map(");
  });

  test("shownEntries is the filter applied to the scan", () => {
    const code: string = readCode();

    const declaration: string = code.slice(
      code.indexOf("const shownEntries"),
      code.indexOf("const selectedCount"),
    );

    expect(declaration).toContain("filterDiscoveredHosts({");
    expect(declaration).toContain("hosts: reviewEntries");
    expect(declaration).toContain("filter: hostFilter");
  });

  test("a scan opens on All, and closing resets to All", () => {
    /*
     * A filter that persisted across scans would mean opening a review and
     * being shown a subset with no memory of having asked for it.
     */
    const code: string = readCode();

    const openBody: string = code.slice(
      code.indexOf("const openReviewModal"),
      code.indexOf("const closeReviewModal"),
    );

    const closeBody: string = code.slice(
      code.indexOf("const closeReviewModal"),
      code.indexOf("const importSelectedDevices"),
    );

    expect(openBody).toContain("setHostFilter(DiscoveredHostFilter.All)");
    expect(closeBody).toContain("setHostFilter(DiscoveredHostFilter.All)");
    expect(openBody).toContain("setImportedIpAddresses(new Set<string>())");
    expect(closeBody).toContain("setImportedIpAddresses(new Set<string>())");
  });
});

describe("the bulk selection control", () => {
  test("it exists, is addressable, and toggles only the shown group", () => {
    const section: string = modalSection();

    expect(section).toContain('dataTestId="discovered-device-select-all"');
    expect(section).toContain("toggleSelectionForShownHosts({");
    expect(section).toContain("filter: hostFilter");
  });

  test("it is disabled when the shown group has nothing to select", () => {
    expect(modalSection()).toContain(
      "disabled={selectableShownCount === 0 || isImporting}",
    );
  });

  test("its label follows whether the shown group is already full", () => {
    expect(modalSection()).toContain("areAllShownSelected");
  });

  test("it updates selection functionally, not from a captured value", () => {
    /*
     * Two presses in the same tick against a stale `selectedIps` would drop
     * the first one's work.
     */
    expect(modalSection()).toContain(
      "setSelectedIps((current: Record<string, boolean>) =>",
    );
  });
});

describe("what the dialog tells the operator", () => {
  test("it no longer claims hosts without SNMP cannot be imported", () => {
    /*
     * That stopped being true when ping-only hosts started importing as
     * monitor-backed devices, and it reads as a flat contradiction next to a
     * No SNMP filter whose entire purpose is importing them as a batch.
     */
    expect(readSource()).not.toContain(
      "Select the ones you want to import as Network Devices — hosts without SNMP cannot be imported.",
    );
  });

  test("an empty scan is not described as having found no SNMP devices", () => {
    // Ping-only hosts are listed too, so "no SNMP devices" is the wrong claim.
    expect(readSource()).not.toContain(
      "This scan did not find any SNMP devices.",
    );
    expect(modalSection()).toContain(
      "This scan did not find any responding hosts.",
    );
  });

  test("a group that filters to nothing says so instead of rendering blank", () => {
    const section: string = modalSection();

    expect(section).toContain("shownEntries.length === 0");
    expect(section).toContain("hosts in this scan.");
  });

  test("the row badge and the filter button use the same words", () => {
    /*
     * The pill on a ping-only row reads "No SNMP". The button that filters to
     * those rows is labelled from getDiscoveredHostFilterLabel, which returns
     * the same string — the two must not drift into near-synonyms the operator
     * has to connect.
     */
    expect(modalSection()).toContain("No SNMP");
    expect(readCode()).toContain("getDiscoveredHostFilterLabel(hostFilter)");
  });

  test("the row badge is decided by the same predicate the filter groups by", () => {
    /*
     * A row can carry the No SNMP pill and a filter can collect No SNMP rows;
     * if those are two separate expressions they can drift, and the dialog
     * ends up showing a badged host that the No SNMP filter hides.
     */
    expect(modalSection()).toContain("isPingOnlyDiscoveredHost(entry)");
    expect(modalSection()).not.toContain(
      "NetworkDeviceMonitoringMethod.Monitor",
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
  });
});
