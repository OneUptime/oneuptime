import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * The discovery import dialog (Network > Discovery > Review Results; issues
 * #4811-#4813) has rules a rendered test sees only through their effects,
 * and a few whose failure renders perfectly:
 *
 *   - Import brings in what is ticked AND shown. The dialog opens with every
 *     host ticked, so an import that stopped going through
 *     getDiscoveredHostsToImport with the WHOLE view - search, both facets,
 *     the already-added switch - would quietly create the hosts the reviewer
 *     just searched or filtered away. Its twin: the count on Next, on the
 *     footer and on "Import N devices" has to be that very list's length.
 *   - Selection changes are functional. Two presses in one tick (select-all,
 *     then a row) must both land; a handler that spread a captured
 *     selection would drop the first.
 *   - A filter change is a view change, not a remount: the row key is the
 *     host's place in the WHOLE scan, and the checkbox is seeded and
 *     reconciled from the same value, or the whole selection paints
 *     unticked for a frame on every facet click.
 *   - An answer that arrives after the dialog moved on is dropped, and the
 *     hosts an import put in the inventory read "Already added" at once.
 *
 * Rendered, end to end, in Common/Tests/App/Dashboard/DiscoveryImportDialog
 * and the E2E Discovery suite. This pins the wiring itself, the fs/path way
 * the other Discovery* source suites do: comments stripped, so prose about a
 * rule never passes for the rule, and whitespace squashed, so Prettier can
 * reflow freely. Every slice proves its markers exist first.
 *
 * It replaces three suites written against the import that ran in the
 * browser (DiscoveryReviewFilterInvariants, DiscoveryReviewLifecycleInvariants
 * and DiscoveryPingMonitorProvisioning): the loop, its close gate and its
 * per-host Ping monitors are gone, and the import is the server's
 * (DiscoveryImportRunner, with its own suite).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const DIALOG: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DiscoveryImport",
  "DiscoveryImportDialog.tsx",
);
const TABLE: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DiscoveryImport",
  "DiscoveredHostTable.tsx",
);
const REVIEW: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "DiscoveryImport",
  "DiscoveryImportReview.ts",
);
const PAGE: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "Discovery.tsx",
);

const WHITESPACE_RUNS: RegExp = /\s+/g;
const BLOCK_COMMENTS: RegExp = /\/\*[\s\S]*?\*\//g;
// Not after a colon, so "https://" in a string is not taken for a comment.
const LINE_COMMENTS: RegExp = /(^|[^:])\/\/[^\n]*/g;

const cachedCode: Map<string, string> = new Map<string, string>();

/** A file with comments removed and whitespace squashed, read once per run. */
function readCode(file: string): string {
  if (!cachedCode.has(file)) {
    cachedCode.set(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(BLOCK_COMMENTS, " ")
        .replace(LINE_COMMENTS, "$1")
        .replace(WHITESPACE_RUNS, " "),
    );
  }

  return cachedCode.get(file)!;
}

/** The text between two markers, both proven to exist. */
function section(file: string, from: string, to: string): string {
  const code: string = readCode(file);
  const start: number = code.indexOf(from);
  const end: number = start === -1 ? -1 : code.indexOf(to, start + from.length);

  expect({ from: from, found: start > -1 }).toEqual({
    from: from,
    found: true,
  });
  expect({ to: to, found: end > -1 }).toEqual({ to: to, found: true });

  return code.slice(start, end);
}

function count(code: string, needle: string): number {
  return code.split(needle).length - 1;
}

describe("Import brings in what is ticked and shown", () => {
  test("the hosts to import are the shared helper's, over the whole view", () => {
    expect(readCode(DIALOG)).toContain(
      "const hostsToImport: Array<DiscoveredNetworkDevice> = useMemo(() => { return getDiscoveredHostsToImport({ hosts: hosts, filter: fullQuery, selectedIpAddresses: selection, }); }, [hosts, fullQuery, selection]);",
    );
  });

  test("the view is the query the list shows, with the scan's naming", () => {
    /*
     * The search matches the name the row shows - a short name, on a scan
     * that asks for short names - so the list and the import read the same
     * query, naming included.
     */
    expect(readCode(DIALOG)).toContain(
      "const fullQuery: DiscoveredHostQuery = useMemo(() => { return { ...query, naming: naming }; }, [query, scan?.useShortDeviceNames]);",
    );
    expect(readCode(DIALOG)).toContain("query={fullQuery}");
  });

  test("the import asks for exactly those addresses, and nothing reworks the rule inline", () => {
    const start: string = section(
      DIALOG,
      "const startImport",
      "const stopImport",
    );

    expect(start).toContain(
      "ipAddresses: hostsToImport.map( (host: DiscoveredNetworkDevice): string => { return host.ipAddress; }, ),",
    );
    // No second spelling of "selected and importable" anywhere in the dialog.
    expect(readCode(DIALOG)).not.toContain("selection[");
    expect(readCode(DIALOG)).not.toContain(".isAlreadyRegistered");
  });

  test("every count the reader is shown is that list's length", () => {
    const code: string = readCode(DIALOG);

    // Next is offered only with something to import, and not too much.
    expect(code).toContain(
      "isSubmitDisabled = isLoading || hostsToImport.length === 0 || hostsToImport.length > MAX_HOSTS_PER_DISCOVERY_IMPORT;",
    );
    // "N hosts will be imported" under the list.
    expect(code).toContain(
      'translator.translatePlural( { one: "{{count}} host will be imported", other: "{{count}} hosts will be imported", }, hostsToImport.length, { count: translator.formatNumber(hostsToImport.length) }, )',
    );
    // "Import N devices" on the button that sends them.
    expect(code).toContain(
      'translator.translatePlural( { one: "Import {{count}} device", other: "Import {{count}} devices", }, hostsToImport.length, { count: translator.formatNumber(hostsToImport.length) }, )',
    );
    // And what is checked before sending is about that same list.
    expect(code).toContain("hostCount: hostsToImport.length,");
  });

  test("more hosts than one import may carry are refused before Next, not after Import, and the footer says how to go on", () => {
    expect(readCode(DIALOG)).toContain(
      '{hostsToImport.length > MAX_HOSTS_PER_DISCOVERY_IMPORT ? translator.translateTemplate( "One import brings in up to {{max}} hosts: narrow the selection, then import the rest after.",',
    );
  });
});

describe("the list's facets and selection", () => {
  test("each facet counts the hosts the rest of the view lets through", () => {
    const code: string = readCode(TABLE);

    expect(code).toContain(
      'getHostsCountedByFacet({ hosts: hosts, query: query, facet: "answered" })',
    );
    expect(code).toContain(
      'getHostsCountedByFacet({ hosts: hosts, query: query, facet: "name" })',
    );
  });

  test("the rows are the shared view of the scan, keeping their place in it", () => {
    expect(readCode(TABLE)).toContain(
      "return getShownDiscoveredHosts({ hosts: hosts, filter: query });",
    );
  });

  test("select all toggles the shown hosts only, from the selection as it is", () => {
    expect(section(TABLE, "const toggleShown", "return (")).toContain(
      "props.onSelectionChange((current: Record<string, boolean>) => { return toggleSelectionForShownHosts({ hosts: hosts, filter: query, selectedIpAddresses: current, }); });",
    );
  });

  test("a row's box changes its own host, from the selection as it is", () => {
    expect(readCode(TABLE)).toContain(
      "props.onSelectionChange( (current: Record<string, boolean>) => { return { ...current, [shown.host.ipAddress]: value, }; }, );",
    );
  });

  test("the dialog hands the update itself to React, never a captured selection", () => {
    expect(readCode(DIALOG)).toContain(
      "onSelectionChange={( update: ( current: Record<string, boolean>, ) => Record<string, boolean>, ) => { setSelection(update); }}",
    );
  });

  test("the count of ticked hosts the view hides is the shared helper's", () => {
    expect(readCode(TABLE)).toContain(
      "countSelectedDiscoveredHosts({ hosts: hosts, filter: query, selectedIpAddresses: props.selectedIpAddresses, });",
    );
  });
});

describe("each row agrees with the counts above it", () => {
  const row: () => string = (): string => {
    return section(
      TABLE,
      "export const DiscoveredHostRow",
      "export default DiscoveredHostTable",
    );
  };

  test("the No SNMP pill is decided by the predicate the facet groups by", () => {
    expect(row()).toContain(
      "const isPingOnly: boolean = isPingOnlyDiscoveredHost(entry);",
    );
  });

  test("the box is enabled by the shared selectability rule", () => {
    expect(row()).toContain(
      "const isSelectable: boolean = isSelectableDiscoveredHost(entry);",
    );
    expect(row()).toContain("disabled={!isSelectable || props.isDisabled}");
  });

  test("a row that cannot be selected never renders as ticked", () => {
    expect(row()).toContain(
      "const isChecked: boolean = isSelectable && props.isChecked;",
    );
    expect(readCode(TABLE)).toContain(
      "isChecked={ isSelectableDiscoveredHost(shown.host) && isSelectedIpAddress({ selectedIpAddresses: props.selectedIpAddresses, ipAddress: shown.host.ipAddress, }) }",
    );
  });
});

describe("a filter change is a view change, not a remount", () => {
  test("the row key is the host's place in the whole scan", () => {
    expect(readCode(TABLE)).toContain(
      "key={`${shown.host.ipAddress}-${shown.scanIndex}`}",
    );
    expect(readCode(TABLE)).not.toMatch(KEY_FROM_LIST_INDEX);
  });

  test("the row's box is seeded and reconciled from the same value", () => {
    expect(
      section(
        TABLE,
        "<CheckboxElement dataTestId={`discovered-device-checkbox-",
        "onChange={(value: boolean)",
      ),
    ).toContain("initialValue={isChecked} value={isChecked}");
  });
});

describe("an answer that arrives too late changes nothing", () => {
  test("each open is numbered, and only the latest one's reads land", () => {
    const open: string = section(
      DIALOG,
      "useEffect(() => { openRequestRef",
      "}, [scanId]);",
    );

    expect(open).toContain(
      "openRequestRef.current += 1; const request: number = openRequestRef.current;",
    );
    expect(count(open, "request !== openRequestRef.current")).toBe(1);
    expect(count(open, "request === openRequestRef.current")).toBe(2);
  });

  test("another scan's review is a new dialog, never this one's state", () => {
    expect(readCode(PAGE)).toContain(
      '<DiscoveryImportDialog key={scanToReview._id?.toString() || ""} scan={scanToReview}',
    );
  });

  test("an import still running when the dialog opens is shown, not a fresh choice of hosts", () => {
    expect(readCode(DIALOG)).toContain(
      "} else if (latest && isDiscoveryImportActive(latest.status)) { setImportId(latest.id); setStep(DiscoveryImportStep.Progress); } else { setLastImport(latest); }",
    );
  });
});

describe("what an import put in the inventory reads as added at once", () => {
  test("the list is the scan's hosts with this sitting's imports marked", () => {
    expect(readCode(DIALOG)).toContain(
      "return getReviewHosts({ scan: scan, importedAddresses: importedAddresses, });",
    );
    // The hosts are read through the shared, tested helper.
    expect(readCode(REVIEW)).toContain(
      "hosts: normalizeDiscoveredHosts(getDiscoveredHosts(data.scan)),",
    );
    expect(readCode(DIALOG)).not.toContain("discoveredDevices");
  });

  test("a finished import's addresses are added to the record functionally, and the scan read again", () => {
    const finished: string = section(
      DIALOG,
      "const onFinished",
      "const polling",
    );

    expect(finished).toContain(
      "setImportedAddresses((current: Set<string>) => { return new Set<string>([...current, ...addresses]); });",
    );
    expect(finished).toContain(
      "getDiscoveryImport(view.id, { allResults: true })",
    );
    expect(finished).toContain("readScan({ reseedSelection: false })");
    expect(finished).toContain("props.onImportsChanged();");
  });
});

// A key taken from the position in the shown list, which moves with every view.
const KEY_FROM_LIST_INDEX: RegExp = /key=\{[^}]*\bindex\b/;
