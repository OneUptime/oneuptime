import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The profiles table's wiring for the entity-key locked pill. What the pill
 * SAYS is pinned in ProfilesEntityKeyLockedScope.test.ts; what this suite
 * owns is that ProfileTable actually builds it, from the right inputs, and
 * shows it — and that it stays a picture of the scope, not a second copy of
 * it:
 *
 *  - the table declares the display map the Inventory page hands it, and
 *    builds the chips from `props.entityKeys` + that map for "profiles";
 *  - the chips render as the shared grey LockedFilterChip, first in the pill
 *    row, and a locked chip opens that row with no deep link set;
 *  - nothing but the pill row reads the chips, so the query, the table and
 *    the deep-link pills behave exactly as before;
 *  - only the explicit entityKeys prop builds a pill, so a table scoped some
 *    other way (a Kubernetes cluster's entityScope, a Service's modelId) gets
 *    none.
 *
 * That the Inventory item's Profiles page hands the table its key and names,
 * and that the helper modules stay window-free, is pinned in
 * InventoryLockedScopeWiring.test.ts.
 *
 * ProfileTable cannot be rendered in these plain-node suites (it reaches the
 * route map at load), so the connections are read from its source. The
 * assertions check MEMBERSHIP inside a balanced slice, never the shape of a
 * neighbouring statement: other features edit this file, and a wiring test
 * that pins unrelated lines breaks while the connection it guards holds.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/*
 * The balanced `opener`..`closer` region after `marker`, so an assertion can
 * say "inside THIS call" rather than "somewhere in the file".
 */
function blockAfter(
  source: string,
  marker: string,
  opener: string,
  closer: string,
): string {
  const markerAt: number = source.indexOf(marker);

  if (markerAt < 0) {
    throw new Error(`Marker not found in source: ${marker}`);
  }

  /*
   * A marker that ENDS with the opener names the region itself (`useMemo(`);
   * searching from the marker's start would catch an opener inside the
   * marker — the `(` of a `() =>` type annotation — and slice an empty pair.
   */
  const start: number = marker.endsWith(opener)
    ? markerAt + marker.length - 1
    : source.indexOf(opener, markerAt);

  if (start < 0) {
    throw new Error(`No "${opener}" after marker: ${marker}`);
  }

  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source.charAt(index);

    if (character === opener) {
      depth++;
    } else if (character === closer) {
      depth--;

      if (depth === 0) {
        return source.slice(start + 1, index);
      }
    }
  }

  throw new Error(`Unbalanced "${opener}" after marker: ${marker}`);
}

/*
 * The dependency array of a hook whose whole call is `hookBody`: the text
 * between the LAST `},[` and the closing `]`. Located from the end, so the
 * body's final statement can change without the array "vanishing".
 */
function dependencyList(hookBody: string): string {
  const depsStart: number = hookBody.lastIndexOf("}, [");

  if (depsStart < 0) {
    throw new Error("No dependency array in hook body");
  }

  const depsEnd: number = hookBody.indexOf("]", depsStart);

  if (depsEnd < 0) {
    throw new Error("Unterminated dependency array in hook body");
  }

  return hookBody.slice(depsStart + "}, [".length, depsEnd);
}

/*
 * The names imported from one module, whatever order or line breaks the
 * import statement uses.
 */
function importedNames(source: string, moduleSpecifier: string): Array<string> {
  const statementEnd: number = source.indexOf(`} from "${moduleSpecifier}";`);

  if (statementEnd < 0) {
    throw new Error(`No import from ${moduleSpecifier}`);
  }

  const statementStart: number = source.lastIndexOf("import {", statementEnd);

  return source
    .slice(statementStart + "import {".length, statementEnd)
    .split(",")
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}

/** Every index at which `needle` starts in `source`. */
function indexesOf(source: string, needle: string): Array<number> {
  const indexes: Array<number> = [];
  let from: number = source.indexOf(needle);

  while (from >= 0) {
    indexes.push(from);
    from = source.indexOf(needle, from + needle.length);
  }

  return indexes;
}

const PROFILE_TABLE: string = readSource(
  "Components",
  "Profiles",
  "ProfileTable.tsx",
);

const CHIP_MEMO_MARKER: string =
  "const lockedEntityKeyChips: Array<ActiveFilter> = useMemo(";
const CHIP_MEMO: string = blockAfter(PROFILE_TABLE, CHIP_MEMO_MARKER, "(", ")");

const QUERY_MEMO: string = blockAfter(
  PROFILE_TABLE,
  "const query: Query<Profile> = React.useMemo(",
  "(",
  ")",
);

const FILTER_ROW: string = blockAfter(
  PROFILE_TABLE,
  "{showFilterRow && (",
  "(",
  ")",
);

const LOCKED_CHIP_MAP: string = blockAfter(
  PROFILE_TABLE,
  "lockedEntityKeyChips.map(",
  "(",
  ")",
);

const EARLY_RETURN: string = "if (isPageLoading) { return <PageLoader";

describe("ProfileTable accepts the Inventory page's display map", () => {
  const props: string = blockAfter(
    PROFILE_TABLE,
    "export interface ComponentProps",
    "{",
    "}",
  );

  test("declares entityKeyDisplays next to entityKeys, typed by the shared chip module", () => {
    expect(props).toContain("entityKeys?: Array<string> | undefined;");
    expect(props).toContain(
      "entityKeyDisplays?: LockedEntityKeyDisplayMap | undefined;",
    );
  });

  test("imports the chip builder and the display map type from the pure chip module", () => {
    const names: Array<string> = importedNames(
      PROFILE_TABLE,
      "../../Utils/LockedEntityKeyChips",
    );

    expect(names).toContain("buildLockedEntityKeyChips");
    expect(names).toContain("LockedEntityKeyDisplayMap");
  });

  test("imports the row predicate from the pure profiles display module", () => {
    expect(
      importedNames(PROFILE_TABLE, "../../Utils/ProfilesEntityDisplay"),
    ).toContain("hasProfileTableFilterRow");
  });

  test("renders the SHARED locked pill from Common, not a hand-rolled grey pill", () => {
    expect(PROFILE_TABLE).toContain(
      'import LockedFilterChip from "Common/UI/Components/TelemetryViewer/components/LockedFilterChip";',
    );
    // The chips are the generic viewer shell's, as the shared builder types them.
    expect(
      importedNames(
        PROFILE_TABLE,
        "Common/UI/Components/TelemetryViewer/types",
      ),
    ).toContain("ActiveFilter");
    // The shared chip's own class list, copied inline, would be a second pill.
    expect(PROFILE_TABLE).not.toContain(
      "rounded-md border border-gray-300 bg-gray-100",
    );
  });
});

describe("ProfileTable builds the locked chips from its entity-key scope", () => {
  const builderCall: string = blockAfter(
    CHIP_MEMO,
    "buildLockedEntityKeyChips(",
    "{",
    "}",
  );

  test("the memo calls the shared builder for profiles with the page's keys and display map", () => {
    expect(CHIP_MEMO).toContain("return buildLockedEntityKeyChips({");
    expect(builderCall).toContain('rows: "profiles",');
    expect(builderCall).toContain("entityKeys: props.entityKeys,");
    expect(builderCall).toContain("displays: props.entityKeyDisplays,");
  });

  test("the memo recomputes when the keys or the display map change", () => {
    const deps: string = dependencyList(CHIP_MEMO);

    expect(deps).toContain("props.entityKeys");
    expect(deps).toContain("props.entityKeyDisplays");
  });

  test("the memo runs before the loading early-return (rules of hooks)", () => {
    const memoAt: number = PROFILE_TABLE.indexOf(CHIP_MEMO_MARKER);
    const earlyReturnAt: number = PROFILE_TABLE.indexOf(EARLY_RETURN);

    expect(memoAt).toBeGreaterThanOrEqual(0);
    expect(earlyReturnAt).toBeGreaterThan(memoAt);
  });

  test("REGRESSION: only the explicit entityKeys prop builds a pill — never entityScope, modelId or a deep link", () => {
    /*
     * A Kubernetes cluster's or a host's Profiles page scopes through
     * profileQuery.entityScope, a Service's through modelId. Neither is an
     * Inventory entity-key scope, and neither may grow a "Resource: <hash>"
     * pill from this memo.
     */
    for (const other of [
      "profileQuery",
      "entityScope",
      "modelId",
      "serviceIdFilter",
      "traceIdFilter",
      "profileTypeFilter",
      "baseQuery",
      "query",
    ]) {
      expect(CHIP_MEMO).not.toContain(other);
    }
  });
});

describe("ProfileTable shows the locked chips as grey pills", () => {
  test("each chip is one LockedFilterChip carrying its explanation", () => {
    expect(LOCKED_CHIP_MAP).toContain("<LockedFilterChip");
    expect(LOCKED_CHIP_MAP).toContain("displayKey={chip.displayKey}");
    expect(LOCKED_CHIP_MAP).toContain("displayValue={chip.displayValue}");
    expect(LOCKED_CHIP_MAP).toContain("lockedDetail={chip.lockedDetail}");
  });

  test("pills are keyed by facet and value, so each key renders once", () => {
    expect(LOCKED_CHIP_MAP).toContain(
      "key={`readonly:${chip.facetKey}:${chip.value}`}",
    );
  });

  test("the pill is the only LockedFilterChip the table renders, and it lives in the pill row", () => {
    expect(indexesOf(PROFILE_TABLE, "<LockedFilterChip")).toHaveLength(1);
    expect(FILTER_ROW).toContain("lockedEntityKeyChips.map(");
  });

  test("a locked pill cannot be removed and never touches the URL", () => {
    for (const forbidden of [
      "onClick",
      "<button",
      "Navigation",
      "setQueryString",
      "setTraceIdFilter",
      "setServiceIdFilter",
      "setProfileTypeFilter",
    ]) {
      expect(LOCKED_CHIP_MAP).not.toContain(forbidden);
    }
  });

  test("profiles are not an explorer signal: the pill names none and the table offers no Copy filter / Open in action", () => {
    /*
     * An entity-key chip has no search token, so a "Copy filter" button
     * would copy nothing and an "Open in" link would drop the scope.
     */
    expect(LOCKED_CHIP_MAP).not.toContain("signal=");
    expect(PROFILE_TABLE).not.toContain("LockedFilterActions");
    expect(PROFILE_TABLE).not.toContain("buildLockedScopeCopyText");
    expect(PROFILE_TABLE).not.toContain("buildLockedScopeExplorerLink");
  });
});

describe("ProfileTable's pill row opens for a locked chip", () => {
  test("the row condition comes from the pure predicate, fed the locked chips and every deep link", () => {
    const predicateCall: string = blockAfter(
      PROFILE_TABLE,
      "const showFilterRow: boolean = hasProfileTableFilterRow(",
      "(",
      ")",
    );

    expect(predicateCall).toContain("lockedChips: lockedEntityKeyChips,");
    expect(predicateCall).toContain("traceIdFilter,");
    expect(predicateCall).toContain("serviceIdFilter,");
    expect(predicateCall).toContain("profileTypeFilter,");
  });

  test("REGRESSION: the row no longer opens only for a deep link", () => {
    expect(PROFILE_TABLE).not.toContain(
      "{(traceIdFilter || serviceIdFilter || profileTypeFilter) && (",
    );
  });

  test("locked pills lead the row, before the user's removable deep-link pills", () => {
    const lockedAt: number = FILTER_ROW.indexOf("lockedEntityKeyChips.map(");

    expect(lockedAt).toBeGreaterThanOrEqual(0);

    for (const userPill of [
      "{traceIdFilter && (",
      "{serviceIdFilter && serviceFilterChip && (",
      "{profileTypeFilter && (",
    ]) {
      const userPillAt: number = FILTER_ROW.indexOf(userPill);

      expect(userPillAt).toBeGreaterThan(lockedAt);
    }
  });

  test("the row sits above the table it describes", () => {
    const rowAt: number = PROFILE_TABLE.indexOf("{showFilterRow && (");
    const tableAt: number = PROFILE_TABLE.indexOf(
      "<AnalyticsModelTable<Profile>",
    );

    expect(rowAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeGreaterThan(rowAt);
  });
});

describe("the locked chips are display only", () => {
  test("the entityKeys query clause still reads the raw prop", () => {
    expect(QUERY_MEMO).toContain("props.entityKeys");
    expect(QUERY_MEMO).toContain("new Includes(");
    expect(dependencyList(QUERY_MEMO)).toContain("props.entityKeys");
  });

  test("the query never reads the chips, the display map or the row predicate", () => {
    for (const displayOnly of [
      "lockedEntityKeyChips",
      "entityKeyDisplays",
      "buildLockedEntityKeyChips",
      "showFilterRow",
      "lockedDetail",
    ]) {
      expect(QUERY_MEMO).not.toContain(displayOnly);
    }
  });

  test("every use of the chips is their memo, the row predicate or the pill map — nothing else reads them", () => {
    const uses: Array<number> = indexesOf(
      PROFILE_TABLE,
      "lockedEntityKeyChips",
    );

    expect(uses.length).toBeGreaterThanOrEqual(3);

    for (const at of uses) {
      const isMemo: boolean = PROFILE_TABLE.startsWith(
        "lockedEntityKeyChips: Array<ActiveFilter> = useMemo(",
        at,
      );
      const isPillMap: boolean = PROFILE_TABLE.startsWith(
        "lockedEntityKeyChips.map(",
        at,
      );
      const isRowPredicate: boolean =
        PROFILE_TABLE.slice(at - "lockedChips: ".length, at) ===
        "lockedChips: ";

      expect({ at, allowed: isMemo || isPillMap || isRowPredicate }).toEqual({
        at,
        allowed: true,
      });
    }
  });

  test("the display map is read only inside the chip memo", () => {
    const memoStart: number = PROFILE_TABLE.indexOf(CHIP_MEMO_MARKER);
    const memoEnd: number =
      memoStart + CHIP_MEMO_MARKER.length + CHIP_MEMO.length;
    const reads: Array<number> = indexesOf(
      PROFILE_TABLE,
      "props.entityKeyDisplays",
    );

    expect(reads.length).toBeGreaterThanOrEqual(1);

    for (const at of reads) {
      expect(at).toBeGreaterThan(memoStart);
      expect(at).toBeLessThan(memoEnd);
    }
  });

  test("the table still receives the query memo, and no chip list", () => {
    expect(PROFILE_TABLE).toContain("query={query}");
    expect(
      PROFILE_TABLE.slice(
        PROFILE_TABLE.indexOf("<AnalyticsModelTable<Profile>"),
      ),
    ).not.toContain("lockedEntityKeyChips");
  });

  test("the entity-name lookup is not fed the pill (its value is an entity key, not an id)", () => {
    const idsMemo: string = blockAfter(
      PROFILE_TABLE,
      "const entityIdsToResolve: Array<string> = useMemo(",
      "(",
      ")",
    );

    expect(idsMemo).not.toContain("lockedEntityKeyChips");
    expect(idsMemo).not.toContain("entityKeys");
  });
});
