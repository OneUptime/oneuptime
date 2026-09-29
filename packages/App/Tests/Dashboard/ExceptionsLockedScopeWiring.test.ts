import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The exceptions explorer's locked pill for an entity-key scope — the chip
 * an Inventory item's Exceptions tab was missing while its list was already
 * narrowed to the item's key.
 *
 * What the pill says, and that it is display only, is unit-tested in
 * ExceptionsLockedEntityKeyChips.test.ts; that the Inventory tab hands the
 * viewer its key and names, and that the chip module stays window-free, in
 * InventoryLockedScopeWiring.test.ts. What is left is structural: that
 * the viewer takes the page's display map, hands the page's own key list to
 * the builder inside the chip memo, lists the pills with the other locked
 * chips ahead of the user's, keeps them out of the display resolver, and
 * that no request builder reads that list. None of that is observable
 * from a helper, and each one degrades silently — back to an empty chip bar,
 * a pill renamed by a facet title, a chip leaking into the query — so this
 * suite reads the source and pins the arrangement.
 *
 * Assertions are on MEMBERSHIP inside a sliced block (this memo, this call),
 * never on the exact text of a whole dependency array or import list: these
 * are shared files other features edit.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (
  root: string,
  ...relativeParts: Array<string>
) => string;

const readSource: ReadSourceFunction = (
  root: string,
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(root, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

type BlockAfterFunction = (
  source: string,
  marker: string,
  opener: string,
  closer: string,
) => string;

/*
 * The balanced `opener`..`closer` region that follows `marker`, both
 * included, so a test can say "inside THIS call" instead of matching a
 * string that happens to appear somewhere else in a 2,300-line component.
 */
const blockAfter: BlockAfterFunction = (
  source: string,
  marker: string,
  opener: string,
  closer: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const start: number = source.indexOf(opener, markerIndex);

  expect(start).toBeGreaterThanOrEqual(0);

  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source.charAt(index);

    if (character === opener) {
      depth++;
    } else if (character === closer) {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced block after marker: ${marker}`);
};

type ImportListFromFunction = (
  source: string,
  moduleSpecifier: string,
) => string;

/* The `import { … }` list that precedes `from "<moduleSpecifier>"`. */
const importListFrom: ImportListFromFunction = (
  source: string,
  moduleSpecifier: string,
): string => {
  const fromIndex: number = source.indexOf(`from "${moduleSpecifier}"`);

  expect(fromIndex).toBeGreaterThanOrEqual(0);

  return source.slice(source.lastIndexOf("import", fromIndex), fromIndex);
};

type DependenciesOfFunction = (source: string, marker: string) => string;

/*
 * The dependency array of the hook whose declaration starts at `marker`:
 * sliced from the hook's closing `]);` back to the last `}, [` before it,
 * so a `return [...]` inside the body can never be mistaken for it.
 */
const dependenciesOf: DependenciesOfFunction = (
  source: string,
  marker: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const end: number = source.indexOf("]);", markerIndex);

  expect(end).toBeGreaterThan(markerIndex);

  const start: number = source.lastIndexOf("}, [", end);

  expect(start).toBeGreaterThan(markerIndex);

  return source.slice(start + "}, [".length, end);
};

type CountOfFunction = (source: string, needle: string) => number;

const countOf: CountOfFunction = (source: string, needle: string): number => {
  return source.split(needle).length - 1;
};

type CallAfterFunction = (source: string, marker: string) => string;

/*
 * The balanced call opened by `marker`, which must END with its `(`
 * (`= useCallback(`). blockAfter starts at the first opener after the
 * marker's start, which for a marker typed `() => Promise<void>` would be the
 * type's own `(`.
 */
const callAfter: CallAfterFunction = (
  source: string,
  marker: string,
): string => {
  const markerIndex: number = source.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);

  return blockAfter(
    source.slice(markerIndex + marker.length - 1),
    "(",
    "(",
    ")",
  );
};

const EXCEPTIONS_VIEWER: string = readSource(
  DASHBOARD_SRC,
  "Components",
  "Exceptions",
  "ExceptionsViewer.tsx",
);

const MERGED_CHIPS_MEMO: string =
  "const mergedActiveFilters: Array<ActiveFilter> = useMemo(";

const PILL_BUILDER_CALL: string = "buildExceptionLockedEntityKeyChips(";

describe("ExceptionsViewer takes the page's entity-key display map", () => {
  test("declares entityKeyDisplays beside entityKeysFilter, typed by the shared chip module", () => {
    const props: string = blockAfter(
      EXCEPTIONS_VIEWER,
      "export interface ExceptionsViewerProps",
      "{",
      "}",
    );

    expect(props).toContain("entityKeysFilter?: Array<string> | undefined;");
    expect(props).toContain(
      "entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;",
    );
    expect(
      importListFrom(EXCEPTIONS_VIEWER, "../../Utils/LockedEntityKeyChips"),
    ).toContain("LockedEntityKeyDisplayMap");
  });

  test("imports the pill builder from the renderer-free chip display module", () => {
    expect(
      importListFrom(
        EXCEPTIONS_VIEWER,
        "../../Utils/ExceptionsEntityChipDisplay",
      ),
    ).toContain("buildExceptionLockedEntityKeyChips");
  });
});

describe("the pill joins the locked chips, ahead of the user's", () => {
  const memo: string = blockAfter(
    EXCEPTIONS_VIEWER,
    MERGED_CHIPS_MEMO,
    "(",
    ")",
  );

  test("the builder reads the page's own key list and display map, and the stored scope's chips", () => {
    const call: string = blockAfter(memo, PILL_BUILDER_CALL, "{", "}");

    for (const argument of [
      "entityKeysFilter: props.entityKeysFilter,",
      "entityKeyDisplays: props.entityKeyDisplays,",
      "storedScopeChips: hostScope.chips,",
    ]) {
      expect(call).toContain(argument);
    }
  });

  test("the pills are pushed into the locked base, which the chip bar lists before the user's chips", () => {
    const callIndex: number = memo.indexOf(PILL_BUILDER_CALL);

    expect(callIndex).toBeGreaterThanOrEqual(0);

    const pushIndex: number = memo.lastIndexOf("base.push(", callIndex);

    expect(pushIndex).toBeGreaterThanOrEqual(0);

    // The balanced push call that precedes the builder is the one holding it.
    const push: string = blockAfter(
      memo.slice(pushIndex),
      "base.push(",
      "(",
      ")",
    );

    expect(push).toContain(PILL_BUILDER_CALL);
  });

  test("the pills skip resolveDisplay, so no facet config sharing their facetKey can rename the entity the page named", () => {
    const callIndex: number = memo.indexOf(PILL_BUILDER_CALL);

    expect(callIndex).toBeGreaterThanOrEqual(0);

    const call: string = blockAfter(
      memo.slice(callIndex),
      PILL_BUILDER_CALL,
      "(",
      ")",
    );
    const before: string = memo.slice(0, callIndex).trimEnd();
    const after: string = memo
      .slice(callIndex + PILL_BUILDER_CALL.length - 1 + call.length)
      .trimStart();

    // Spread straight into the locked row: neither wrapped nor mapped.
    expect(before.endsWith("...")).toBe(true);
    expect(before.endsWith("resolveDisplay(")).toBe(false);
    expect(after.startsWith(".map(")).toBe(false);
  });

  test("the chip bar rebuilds when the page's key list, its display map or the stored scope changes", () => {
    const dependencies: string = dependenciesOf(
      EXCEPTIONS_VIEWER,
      MERGED_CHIPS_MEMO,
    );

    for (const dependency of [
      "props.entityKeysFilter",
      "props.entityKeyDisplays",
      "hostScope",
      "activeFilters",
    ]) {
      expect(dependencies).toContain(dependency);
    }
  });

  test("the pill has exactly one source — the explicit entityKeysFilter prop — so a host scoped any other way gets no extra chip", () => {
    expect(countOf(EXCEPTIONS_VIEWER, PILL_BUILDER_CALL)).toBe(1);
    expect(memo).toContain(PILL_BUILDER_CALL);
    /*
     * The exceptions noun and the stored-scope skip live in the builder; a
     * second, bare call to the shared chip would bypass both.
     */
    expect(EXCEPTIONS_VIEWER).not.toContain("buildLockedEntityKeyChips(");
  });
});

describe("the pill is display only", () => {
  test("the merged chips reach the chip bar, and none of the list query, the chart, the facet counts, the URL or Clear all reads them", () => {
    expect(
      countOf(EXCEPTIONS_VIEWER, "activeFilters={mergedActiveFilters}"),
    ).toBe(1);

    const requestBuilders: Array<[string, string]> = [
      [
        "fetchExceptions",
        callAfter(
          EXCEPTIONS_VIEWER,
          "const fetchExceptions: () => Promise<void> = useCallback(",
        ),
      ],
      [
        "fetchHistogram",
        callAfter(
          EXCEPTIONS_VIEWER,
          "const fetchHistogram: () => Promise<void> = useCallback(",
        ),
      ],
      [
        "fetchFacets",
        callAfter(
          EXCEPTIONS_VIEWER,
          "const fetchFacets: () => Promise<void> = useCallback(",
        ),
      ],
      [
        "handleClearAllFilters",
        callAfter(
          EXCEPTIONS_VIEWER,
          "const handleClearAllFilters: () => void = useCallback(",
        ),
      ],
      [
        "writeTelemetryViewerUrlState",
        callAfter(EXCEPTIONS_VIEWER, "writeTelemetryViewerUrlState("),
      ],
    ];

    for (const [name, region] of requestBuilders) {
      // The name rides along so a failure says which one reads the chips.
      expect({
        name,
        readsMergedChips: region.includes("mergedActiveFilters"),
      }).toEqual({ name, readsMergedChips: false });
    }
  });

  test("the entity keys reach the list, chart and facet counts through the instance scope, never through a chip", () => {
    const marker: string =
      "const instanceScope: ExceptionInstanceScope = useMemo(";
    const instanceScopeMemo: string = blockAfter(
      EXCEPTIONS_VIEWER,
      marker,
      "(",
      ")",
    );

    expect(instanceScopeMemo).toContain(
      "buildExceptionEntityKeyScope(props.entityKeysFilter)",
    );
    expect(instanceScopeMemo).not.toContain("entityKeyDisplays");
    expect(instanceScopeMemo).not.toContain(PILL_BUILDER_CALL);
    expect(dependenciesOf(EXCEPTIONS_VIEWER, marker)).toContain(
      "props.entityKeysFilter",
    );
  });

  test("no exceptions facet is keyed entityKeys, so a pill can never mark a sidebar row selected", () => {
    const facetConfigsMemo: string = blockAfter(
      EXCEPTIONS_VIEWER,
      "const facetConfigs: Array<FacetConfig> = useMemo(",
      "(",
      ")",
    );

    expect(facetConfigsMemo).not.toContain('"entityKeys"');
    expect(facetConfigsMemo).not.toContain("ENTITY_KEYS_FACET_KEY");

    const requestedFacetKeys: string = blockAfter(
      EXCEPTIONS_VIEWER,
      "facetKeys:",
      "[",
      "]",
    );

    expect(requestedFacetKeys).not.toContain("entityKeys");
  });

  test("the viewer names no explorer signal, since exceptions have no search bar a pill's syntax could be pasted into", () => {
    /*
     * The JSX element cannot be sliced by brace balancing (its props hold
     * arrow functions and nested elements), so the region is positional:
     * from the element to the end of the component. "exceptions" is not a
     * TelemetrySignal, and the pill has no search token for its tooltip to
     * offer.
     *
     * What the shared chip bar does with a read-only chip (no remove button,
     * a tooltip naming the explorer only when given a signal) is Common's,
     * pinned in
     * Common/Tests/UI/Components/TelemetryActiveFilterChipsLockedFilters.test.tsx.
     */
    const elementStart: number = EXCEPTIONS_VIEWER.indexOf(
      "<TelemetryViewer<TelemetryException>",
    );
    const componentEnd: number = EXCEPTIONS_VIEWER.lastIndexOf(
      "export default ExceptionsViewer;",
    );

    expect(elementStart).toBeGreaterThanOrEqual(0);
    expect(componentEnd).toBeGreaterThan(elementStart);

    const element: string = EXCEPTIONS_VIEWER.slice(elementStart, componentEnd);

    expect(element).toContain("activeFilters={mergedActiveFilters}");
    expect(element).not.toContain("lockedFilterSignal=");
  });

  test("the viewer builds no actions for the locked scope, and imports nothing that would", () => {
    for (const removed of [
      "lockedFilterActions",
      "LockedFilterActions",
      "buildLockedScopeFilterActions",
      "LockedTelemetryScopeLink",
    ]) {
      expect({ removed, present: EXCEPTIONS_VIEWER.includes(removed) }).toEqual(
        { removed, present: false },
      );
    }
  });
});
