import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * DiscoveredHostFilter.ts is where the SNMP / No SNMP rules are, and it is unit
 * tested. What it cannot cover is the dialog's LIFECYCLE — when the Review
 * Discovered Devices modal closes, which scan a finished import is allowed to
 * touch, and what the page remembers between two imports in one sitting. All of
 * that lives in JSX and in an async handler in Discovery.tsx, and the App suite
 * runs in a plain Node environment with no React renderer (see
 * jest.config.json), so none of it can be mounted and clicked.
 *
 * The failure modes are the expensive kind — every one of them renders
 * perfectly:
 *
 *   - Closing the dialog as soon as the SHOWN group is empty throws away the
 *     operator's review of the other group. That is the exact regression #3322
 *     exists to remove: import the switches, and the 2,890 ping-only hosts you
 *     had already triaged are gone from the screen.
 *   - An import of thousands of hosts runs for minutes. If it does not check
 *     which scan it belongs to when it lands, it pushes its errors onto — or
 *     closes — a different scan's dialog that the operator opened meanwhile.
 *   - `isAlreadyRegistered` is frozen into the scan's jsonb at probe-upload
 *     time and never recomputed, so if the page's own record of what it just
 *     imported is cleared or keyed wrong, a reopened dialog re-offers imported
 *     hosts pre-checked and Import creates duplicate Network Devices.
 *   - A row key taken from the filtered list's index changes on every filter
 *     click, remounting each row; CheckboxElement seeds itself from
 *     `initialValue` and only reconciles `value` in a passive effect, so the
 *     whole selection paints unticked for a frame in a dialog whose entire job
 *     is deciding what is ticked.
 *
 * METHOD. Comments are stripped before anything is asserted, so describing a
 * rule in prose can never satisfy a test that the rule is implemented, and
 * whitespace is squashed so Prettier may reflow props freely. Every slice goes
 * through `sliceBetween` / `sliceFrom`, which assert their markers were found:
 * a bare `indexOf` returning -1 silently makes a slice cover the whole file (or
 * nothing at all), and every assertion under it then passes for the wrong
 * reason. Same fs/path approach as InventoryTableInvariants.test.ts.
 *
 * SCOPE. The filter row, the bulk select-all control and the submit button's
 * count are pinned by DiscoveryReviewFilterInvariants.test.ts; this file stays
 * off that ground and covers only the lifecycle.
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

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The page with comments removed and whitespace squashed to single spaces. */
function readCode(): string {
  return stripComments(readSource()).replace(/\s+/g, " ");
}

/**
 * A slice that cannot lie about what it covers.
 *
 * `code.slice(indexOf(a), indexOf(b))` with a missing marker yields either the
 * whole file from the start or an empty string, and both make the assertions
 * underneath meaningless while still going green. Failing here instead points
 * at the rename that actually happened.
 */
function sliceBetween(data: {
  code: string;
  from: string;
  to: string;
}): string {
  const start: number = data.code.indexOf(data.from);
  const end: number = data.code.indexOf(data.to);

  expect({ from: data.from, found: start > -1 }).toEqual({
    from: data.from,
    found: true,
  });
  expect({ to: data.to, after: end > start }).toEqual({
    to: data.to,
    after: true,
  });

  return data.code.slice(start, end);
}

/** Same guarantee for an open-ended slice to the end of the file. */
function sliceFrom(data: { code: string; from: string }): string {
  const start: number = data.code.indexOf(data.from);

  expect({ from: data.from, found: start > -1 }).toEqual({
    from: data.from,
    found: true,
  });

  return data.code.slice(start);
}

/** The whole body of `importSelectedDevices`, up to the render return. */
function importSection(): string {
  return sliceBetween({
    code: readCode(),
    from: "const importSelectedDevices",
    to: "if (isLoading)",
  });
}

/** The `else if` that decides whether a successful import closes the dialog. */
function closeGate(): string {
  return sliceBetween({
    code: importSection(),
    from: "} else if (",
    to: "closeReviewModal();",
  });
}

function openReviewModalBody(): string {
  return sliceBetween({
    code: readCode(),
    from: "const openReviewModal",
    to: "const closeReviewModal",
  });
}

function closeReviewModalBody(): string {
  return sliceBetween({
    code: readCode(),
    from: "const closeReviewModal",
    to: "const importSelectedDevices",
  });
}

/** Everything the Review Discovered Devices modal renders. */
function modalSection(): string {
  return sliceFrom({
    code: readCode(),
    from: 'title="Review Discovered Devices"',
  });
}

describe("the source this file slices", () => {
  test("the page is where the test expects it", () => {
    expect(fs.existsSync(DISCOVERY_PAGE)).toBe(true);
  });

  test("every marker the slices below anchor on appears exactly once", () => {
    /*
     * A marker that appears twice makes a slice cover a region chosen by
     * source order rather than by meaning — the assertions under it would then
     * be about whichever copy happened to come first. Checked once here so the
     * individual tests can assume it.
     */
    const code: string = readCode();

    const markers: Array<string> = [
      "const getReviewHosts",
      "const openReviewModal",
      "const closeReviewModal",
      "const importSelectedDevices",
      "if (isLoading)",
      "const entriesToImport",
      "const importedAfterThisRun",
      "const isStillTheSameReview",
      "closeReviewModal();",
      "{shownEntries.map(",
      "<CheckboxElement",
      'title="Review Discovered Devices"',
    ];

    for (const marker of markers) {
      expect({
        marker: marker,
        occurrences: code.split(marker).length - 1,
      }).toEqual({ marker: marker, occurrences: 1 });
    }

    // The `else if` markers in the status column must not reach the gate.
    expect(importSection().split("} else if (").length - 1).toBe(1);
  });
});

describe("closing the dialog after a successful import", () => {
  test("the gate asks about the whole scan, not the group on screen", () => {
    /*
     * Gating on `hostFilter` would close the dialog the moment the SHOWN group
     * emptied — import the SNMP hosts and the review of the ping-only ones
     * vanishes with it, which is precisely the behaviour #3322 was filed to
     * remove. The question has to be "is there anything left anywhere in this
     * scan", so the filter in the gate is always All.
     */
    const gate: string = closeGate();

    expect(gate).toContain("getDiscoveredHostsToImport({");
    expect(gate).toContain("filter: DiscoveredHostFilter.All");
    expect(gate).not.toContain("filter: hostFilter");
    expect(gate).toContain("}).length === 0");
  });

  test("the gate asks what is still selected, not what is still selectable", () => {
    /*
     * Selectable-but-unticked is a deliberate operator decision. Gating on
     * `countSelectableShownHosts` would keep the dialog open after a complete
     * import whenever a host had been unticked on purpose, leaving a modal
     * whose only button reads "Import Selected (0)" and is disabled.
     */
    const gate: string = closeGate();

    expect(gate).toContain("selectedIpAddresses: selectedIps");
    expect(gate).not.toContain("countSelectableShownHosts");
    expect(gate).not.toContain("isSelectableDiscoveredHost");
    expect(gate).not.toContain("selectableShownCount");
  });

  test("the gate reads the scan with this run's imports already applied", () => {
    /*
     * Asserted as one contiguous string: the hosts the gate counts have to be
     * the overlaid list carrying `importedAfterThisRun`, not the page's
     * captured store and not the raw scan. Fed the raw scan, the hosts just
     * imported still look importable, the count is never zero, and the dialog
     * never closes on success at all.
     */
    expect(closeGate()).toContain(
      "hosts: getReviewHosts(scanToReview, importedAfterThisRun)",
    );
  });

  test("the import path closes the dialog in exactly one place", () => {
    /*
     * A second, unguarded `closeReviewModal()` — in the failure branch, or as
     * a bare `else` after it — reinstates the old close-on-success behaviour
     * while every assertion above still passes on the guarded copy.
     */
    const section: string = importSection();

    expect(section.split("closeReviewModal();").length - 1).toBe(1);
    expect(section).not.toContain("} else { closeReviewModal();");
  });
});

describe("an import that outlives the dialog it started in", () => {
  test("the run remembers the scan it started on and rechecks it at the end", () => {
    /*
     * Thousands of sequential creates take minutes, and nothing stops the
     * operator closing the dialog and opening another scan meanwhile. Without
     * this comparison the run's side effects land on whatever is on screen
     * when it happens to finish.
     */
    const section: string = importSection();

    expect(section).toContain(
      'const runScanId: string = scanToReview._id || ""',
    );
    expect(section).toContain(
      "const isStillTheSameReview: boolean = reviewedScanIdRef.current === runScanId",
    );
  });

  test("the scan under review is held in a ref, not in state", () => {
    /*
     * State would give the run the value captured when it began — exactly the
     * value that cannot answer "is this still the dialog I am importing for".
     * Only a ref reads the live one from inside a closure minutes old.
     */
    expect(readCode()).toContain(
      'const reviewedScanIdRef: React.MutableRefObject<string> = useRef<string>("")',
    );
  });

  test("a stale run cannot push its failures onto the dialog now open", () => {
    /*
     * The toasts still fire — the devices really were created and the operator
     * needs to know — but the inline error belongs to a dialog that is gone.
     * Contiguous, so the guard cannot drift away from the call it protects.
     */
    expect(importSection()).toContain(
      'if (isStillTheSameReview) { setImportError(failures.join(" ")); }',
    );
  });

  test("a stale run cannot close the dialog now open", () => {
    expect(closeGate()).toContain("isStillTheSameReview &&");
  });

  test("the ref is set when a review opens and cleared when it closes", () => {
    /*
     * Left uncleared, the ref still names the scan just closed, so a run that
     * finishes afterwards believes its dialog is open and closes whatever the
     * operator opened next.
     */
    expect(openReviewModalBody()).toContain(
      'reviewedScanIdRef.current = scan._id || ""',
    );
    expect(closeReviewModalBody()).toContain('reviewedScanIdRef.current = ""');
  });
});

describe("the page's record of what this sitting has imported", () => {
  test("the store is keyed by scan id and read back for the scan on screen", () => {
    /*
     * A bare set of addresses written when a long import finally lands would
     * mark the OTHER scan's same-addressed hosts "Already added" — disabled,
     * unticked, silently skipped by Import.
     */
    const code: string = readCode();

    expect(code).toContain("useState<ImportedIpAddressesByScanId>({})");
    expect(code).not.toContain("useState<Set<string>>");

    expect(
      sliceBetween({
        code: code,
        from: "const getReviewHosts",
        to: "const openReviewModal",
      }),
    ).toContain(
      "importedByScanId: importedByScanId || importedIpAddressesByScanId, scanId: scan?._id,",
    );
  });

  test("the store is written against the run's own scan id", () => {
    /*
     * `scanToReview` at the end of a long run is the scan the CLOSURE started
     * with, but the id the record is filed under still has to be stated
     * explicitly as the run's — reading it off page state here is how one
     * scan's imports get attributed to another.
     */
    const updater: string = sliceBetween({
      code: importSection(),
      from: "setImportedIpAddressesByScanId((current",
      to: "const isStillTheSameReview",
    });

    expect(updater).toContain("scanId: runScanId");
    expect(updater).not.toContain("scanId: scanToReview");

    expect(
      sliceBetween({
        code: importSection(),
        from: "const importedAfterThisRun",
        to: "setImportedIpAddressesByScanId((current",
      }),
    ).toContain("scanId: runScanId");
  });

  test("the store is updated functionally, not from a captured value", () => {
    /*
     * Two imports can overlap — start the SNMP group, switch filters, start
     * the ping-only group. Merging into the value captured at render loses
     * whichever landed first, and the hosts it imported come back pre-checked.
     */
    expect(importSection()).toContain(
      "setImportedIpAddressesByScanId((current: ImportedIpAddressesByScanId) => { return withImportedIpAddresses({ importedByScanId: current,",
    );
  });

  test("neither opening nor closing a review clears the store", () => {
    /*
     * Clearing it is what resurrects imported hosts: the scan's own
     * `isAlreadyRegistered` flags were frozen at probe-upload time, so a
     * reopened dialog with no overlay offers what was just imported, ticked,
     * and Import duplicates every one of those devices.
     */
    expect(openReviewModalBody()).not.toContain(
      "setImportedIpAddressesByScanId",
    );
    expect(closeReviewModalBody()).not.toContain(
      "setImportedIpAddressesByScanId",
    );
  });
});

describe("what the dialog opens with, imports, and resets", () => {
  test("the list to import is the overlaid scan, not the raw scan", () => {
    /*
     * One contiguous string on purpose: three independent substring checks
     * would all still pass on a version that called
     * `getDiscoveredHostsToImport` with `getDiscoveredHosts(scanToReview)`,
     * which re-imports everything the previous press already created.
     */
    expect(
      sliceBetween({
        code: importSection(),
        from: "const entriesToImport",
        to: "if (entriesToImport.length === 0)",
      }),
    ).toContain(
      "getDiscoveredHostsToImport({ hosts: getReviewHosts(scanToReview),",
    );
  });

  test("opening a review seeds its selection through the overlay", () => {
    /*
     * `getInitialSelection` ticks every selectable host, so handing it the raw
     * scan re-ticks the ones imported a minute ago. The rest of the body is
     * the dialog's own state: the scan being reviewed, a cleared error from
     * whatever was open before, and the modal made visible.
     */
    const body: string = openReviewModalBody();

    expect(body).toContain(
      "setSelectedIps(getInitialSelection(getReviewHosts(scan)))",
    );
    expect(body).not.toContain("getInitialSelection(getDiscoveredHosts(");
    expect(body).toContain("setScanToReview(scan)");
    expect(body).toContain('setImportError("")');
    expect(body).toContain("setShowReviewModal(true)");
    expect(body).not.toContain("setShowReviewModal(false)");
  });

  test("closing a review drops the scan, the selection and the error", () => {
    /*
     * Anything left behind here is shown by the NEXT review before its own
     * state lands: a stale error banner, or ticks belonging to another scan's
     * addresses.
     */
    const body: string = closeReviewModalBody();

    expect(body).toContain("setShowReviewModal(false)");
    expect(body).toContain("setScanToReview(null)");
    expect(body).toContain("setSelectedIps({})");
    expect(body).toContain('setImportError("")');
    expect(body).not.toContain("setShowReviewModal(true)");
  });
});

describe("a filter change is a view change, not a remount", () => {
  test("the row key is built from the host's position in the unfiltered scan", () => {
    /*
     * `scanIndex` does not move when the filter does. The map callback takes
     * only the entry — there is no second parameter to key from — because an
     * index into the FILTERED list changes on every filter click, changing the
     * key, remounting every row, and repainting the whole selection unticked
     * for a frame.
     */
    const section: string = modalSection();

    expect(section).toContain(
      "{shownEntries.map( (shownEntry: ShownDiscoveredHost): ReactElement => {",
    );
    expect(section).toContain(
      "key={`${entry.ipAddress}-${shownEntry.scanIndex}`}",
    );
  });

  test("the row's checkbox is seeded and reconciled from the same value", () => {
    /*
     * CheckboxElement holds its own state, seeded from `initialValue` and only
     * corrected from `value` in a passive effect. With `value` alone a freshly
     * mounted row is unticked until an effect flushes; with `initialValue`
     * alone it never follows Select all or Clear all at all.
     */
    expect(
      sliceFrom({ code: modalSection(), from: "<CheckboxElement" }),
    ).toContain("initialValue={isChecked} value={isChecked}");
  });
});
